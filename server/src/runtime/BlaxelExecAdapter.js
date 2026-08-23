const crypto = require('crypto');
const { ExecAdapter, RuntimeError, StreamHandle } = require('./interfaces');
const { SandboxInstance, settings } = require('@blaxel/core');

// ─── Interactive bridge ───
// Blaxel's process API has no stdin/PTY support: POST /process is
// request/response, and /process/{id}/logs/stream is a one-way, line-framed
// log feed ("stdout:..." / "stderr:..." prefixes). To drive interactive TUI
// agents we therefore run a small Python relay inside the sandbox that owns a
// real PTY:
//   - agent stdin  <- a named fifo the relay forwards into the PTY master
//   - agent stdout -> the relay's stdout -> /logs/stream -> this handle
//   - window size  <- a size file the relay polls and applies via TIOCSWINSZ
// Input is delivered with short-lived `base64 -d > fifo` exec calls.

const RELAY_DIR = '/tmp/.xe';
const RELAY_PATH = `${RELAY_DIR}/relay.py`;

const RELAY_PY = `import os, pty, select, signal, struct, sys, fcntl, termios, json

argv = json.loads(os.environ.get('XE_ARGV') or '["sh"]')
cwd = os.environ.get('XE_CWD') or '/'
fifo_path = os.environ.get('XE_FIFO') or ''
size_path = os.environ.get('XE_SIZE') or ''
cols = int(os.environ.get('XE_COLS') or '120')
rows = int(os.environ.get('XE_ROWS') or '32')

pid, fd = pty.fork()
if pid == 0:
    try:
        os.chdir(cwd)
    except Exception:
        pass
    try:
        os.execvp(argv[0], argv)
    except Exception as e:
        sys.stderr.write('exec failed: %s\\n' % e)
        os._exit(127)

def apply_size(c, r):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
        os.kill(pid, signal.SIGWINCH)
    except Exception:
        pass

apply_size(cols, rows)

fifo_fd = -1
if fifo_path:
    try:
        fifo_fd = os.open(fifo_path, os.O_RDONLY | os.O_NONBLOCK)
        # Hold a writer fd open so the reader never observes EOF between
        # short-lived input writers.
        os.open(fifo_path, os.O_WRONLY | os.O_NONBLOCK)
    except Exception:
        fifo_fd = -1

out = sys.stdout.buffer
last_size = (cols, rows)
status = None

while True:
    fds = [fd] + ([fifo_fd] if fifo_fd >= 0 else [])
    try:
        r, _, _ = select.select(fds, [], [], 0.5)
    except InterruptedError:
        continue
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b''
        if not data:
            break
        out.write(data)
        out.flush()
    if fifo_fd >= 0 and fifo_fd in r:
        try:
            data = os.read(fifo_fd, 65536)
        except OSError:
            data = b''
        while data:
            n = os.write(fd, data)
            data = data[n:]
    if size_path:
        try:
            with open(size_path) as f:
                parts = f.read().split()
            c, rr = int(parts[0]), int(parts[1])
            if (c, rr) != last_size and c > 0 and rr > 0:
                last_size = (c, rr)
                apply_size(c, rr)
        except Exception:
            pass
    wpid, st = os.waitpid(pid, os.WNOHANG)
    if wpid == pid:
        status = st
        break

# Drain any remaining PTY output, then propagate the child's exit code.
try:
    while True:
        data = os.read(fd, 65536)
        if not data:
            break
        out.write(data)
        out.flush()
except OSError:
    pass

if status is None:
    try:
        _, status = os.waitpid(pid, 0)
    except Exception:
        status = 0
try:
    code = os.waitstatus_to_exitcode(status)
except Exception:
    code = (status >> 8) & 0xff
sys.exit(code if isinstance(code, int) and code >= 0 else 1)
`;

// The log stream frames each server-side write with a "stdout:"/"stderr:"
// prefix (and emits "[keepalive]" lines). Chunk boundaries usually align with
// those frames, so strip prefixes at read-chunk starts and after '\n', while
// buffering a possibly-truncated prefix at the end of a chunk. Everything
// else is passed through byte-for-byte (including '\r' and partial lines,
// which the SDK's own line-based parser would mangle).
function createStreamDeframer() {
    const PREFIXES = ['stdout:', 'stderr:'];
    const KEEPALIVE = '[keepalive]';
    let pending = '';
    return {
        feed(text) {
            let data = pending + text;
            pending = '';
            let out = '';
            let i = 0;
            let atBoundary = true; // read-chunk start counts as a frame boundary
            while (i < data.length) {
                if (atBoundary) {
                    const rest = data.slice(i);
                    let pref = null;
                    for (const p of PREFIXES) {
                        if (rest.startsWith(p)) { pref = p; break; }
                    }
                    if (pref) {
                        i += pref.length;
                        atBoundary = false;
                        continue;
                    }
                    if (rest.startsWith(KEEPALIVE)) {
                        const nl = data.indexOf('\n', i);
                        if (nl === -1) { pending = rest; return out; }
                        i = nl + 1;
                        continue;
                    }
                    if (rest.length < 12
                        && (PREFIXES.some((p) => p.startsWith(rest)) || KEEPALIVE.startsWith(rest))) {
                        pending = rest;
                        return out;
                    }
                    atBoundary = false;
                    continue;
                }
                const ch = data[i];
                out += ch;
                i += 1;
                if (ch === '\n') atBoundary = true;
            }
            return out;
        },
        flush() {
            const rest = pending;
            pending = '';
            return rest;
        },
    };
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped']);

function processIdentifier(result) {
    return result?.pid || result?.id || result?.processId || result?.name;
}

class BlaxelStreamHandle extends StreamHandle {
    constructor(processId, sandboxName, sandbox, meta = {}) {
        super();
        this._processId = processId;
        this._sandboxName = sandboxName;
        this._sandbox = sandbox || null;
        this._fifoPath = meta.fifoPath || null;
        this._sizePath = meta.sizePath || null;
        this._streamId = meta.streamId || null;
        this._dataCbs = [];
        this._exitCbs = [];
        this._closed = false;
        this._exitEmitted = false;
        this._streamStarted = false;
        this._writeQueue = Promise.resolve();
    }

    onData(callback) {
        this._dataCbs.push(callback);
        this._startStreaming();
        return { dispose: () => { this._dataCbs = this._dataCbs.filter((c) => c !== callback); } };
    }

    onExit(callback) {
        this._exitCbs.push(callback);
        this._startStreaming();
        return { dispose: () => { this._exitCbs = this._exitCbs.filter((c) => c !== callback); } };
    }

    write(data) {
        if (this._closed || !data || !this._fifoPath) return;
        // Serialize input writes so pasted text keeps its order.
        this._writeQueue = this._writeQueue.then(() => this._writeFifo(data)).catch(() => {});
    }

    resize(cols, rows) {
        if (this._closed || !this._sizePath) return;
        const c = Math.max(1, cols | 0);
        const r = Math.max(1, rows | 0);
        this._writeQueue = this._writeQueue.then(async () => {
            const sandbox = await this._getSandbox();
            await sandbox.process.exec({
                command: `printf '%s %s' ${c} ${r} > ${this._sizePath}`,
                waitForCompletion: true,
            });
        }).catch(() => {});
    }

    kill() {
        if (this._closed) return;
        this._closed = true;
        (async () => {
            try {
                const sandbox = await this._getSandbox();
                await sandbox.process.kill(this._processId);
            } catch (_) { /* best-effort */ }
        })();
        // The remote kill ends the log stream, which emits exit; force-emit as
        // a fallback in case the stream is already gone.
        setTimeout(() => this._emitExit(0), 3000);
    }

    get pid() { return this._processId; }
    get streamRef() {
        const base = `blaxel:${this._sandboxName}:${this._processId}`;
        return this._streamId ? `${base}:${this._streamId}` : base;
    }

    async _getSandbox() {
        if (!this._sandbox) {
            this._sandbox = await SandboxInstance.get(this._sandboxName);
        }
        return this._sandbox;
    }

    _emitData(data) {
        for (const cb of this._dataCbs) {
            try { cb(data); } catch (_) { /* ignore */ }
        }
    }

    _emitExit(exitCode) {
        if (this._exitEmitted) return;
        this._exitEmitted = true;
        this._closed = true;
        for (const cb of this._exitCbs) {
            try { cb({ exitCode: exitCode ?? 0, signal: null }); } catch (_) { /* ignore */ }
        }
    }

    _startStreaming() {
        if (this._streamStarted) return;
        this._streamStarted = true;
        this._consumeStream().catch(() => this._emitExit(0));
    }

    async _consumeStream() {
        const sandbox = await this._getSandbox();
        const proc = sandbox.process;
        const headers = sandbox.forceUrl ? sandbox.headers : settings.headers;
        const res = await proc.h2Fetch(`${proc.url}/process/${this._processId}/logs/stream`, {
            method: 'GET',
            headers,
        });
        if (res.status !== 200 || !res.body) {
            throw new Error(`log stream failed with status ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const deframer = createStreamDeframer();
        try {
            for (;;) {
                if (this._closed) {
                    try { await reader.cancel(); } catch (_) { /* ignore */ }
                    return;
                }
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value instanceof Uint8Array) {
                    const out = deframer.feed(decoder.decode(value, { stream: true }));
                    if (out) this._emitData(out);
                }
            }
            const rest = deframer.flush();
            if (rest) this._emitData(rest);
        } finally {
            if (!this._closed) {
                // Stream ended: the process has finished. Fetch its exit code.
                let exitCode = 0;
                try {
                    const sandbox = await this._getSandbox();
                    const info = await sandbox.process.get(this._processId);
                    exitCode = info?.exitCode ?? 0;
                } catch (_) { /* unknown */ }
                this._emitExit(exitCode);
            }
        }
    }

    async _writeFifo(data) {
        if (this._closed) return;
        const sandbox = await this._getSandbox();
        const b64 = Buffer.from(String(data), 'utf8').toString('base64');
        await sandbox.process.exec({
            command: `printf %s '${b64}' | base64 -d > ${this._fifoPath}`,
            waitForCompletion: true,
        });
    }
}

class BlaxelExecAdapter extends ExecAdapter {
    constructor() {
        super();
    }

    async _getSandbox(name) {
        return SandboxInstance.get(name);
    }

    /**
     * Re-attach to a previously spawned process from its streamRef
     * (blaxel:<sandbox>:<pid>[:<streamId>]). Used after a server restart.
     */
    async attach(streamRef) {
        const m = /^blaxel:([^:]+):([^:]+)(?::([^:]+))?$/.exec(streamRef || '');
        if (!m) throw new RuntimeError(`invalid blaxel streamRef: ${streamRef}`, 400);
        const [, sandboxName, pid, streamId] = m;
        const sandbox = await this._getSandbox(sandboxName);
        const meta = streamId
            ? {
                streamId,
                fifoPath: `${RELAY_DIR}/in-${streamId}`,
                sizePath: `${RELAY_DIR}/size-${streamId}`,
            }
            : {};
        return new BlaxelStreamHandle(pid, sandboxName, sandbox, meta);
    }

    async spawn(cmd, args, env, options) {
        const sandboxName = options?.runtimeRef;
        if (!sandboxName) throw new RuntimeError('runtimeRef required for spawn', 400);

        try {
            const sandbox = await this._getSandbox(sandboxName);
            const streamId = crypto.randomBytes(6).toString('hex');
            const fifoPath = `${RELAY_DIR}/in-${streamId}`;
            const sizePath = `${RELAY_DIR}/size-${streamId}`;

            // Set up the PTY relay and input fifo inside the sandbox.
            await sandbox.fs.mkdir(RELAY_DIR).catch(() => {});
            await sandbox.fs.write(RELAY_PATH, RELAY_PY);
            await sandbox.process.exec({
                command: `rm -f ${fifoPath} ${sizePath} && mkfifo ${fifoPath}`,
                waitForCompletion: true,
            });

            const argv = [cmd, ...(args || [])];
            const procEnv = {
                ...(env || {}),
                TERM: (env && env.TERM) || 'xterm-256color',
                XE_ARGV: JSON.stringify(argv),
                XE_CWD: options.cwd || '/',
                XE_FIFO: fifoPath,
                XE_SIZE: sizePath,
            };

            const result = await sandbox.process.exec({
                command: `python3 ${RELAY_PATH}`,
                env: procEnv,
                workingDir: options.cwd || undefined,
                timeout: 0,
            });

            const pid = processIdentifier(result);
            if (!pid) throw new Error(`spawn returned no process identifier: ${JSON.stringify(result)}`);
            return new BlaxelStreamHandle(pid, sandboxName, sandbox, {
                fifoPath,
                sizePath,
                streamId,
            });
        } catch (e) {
            if (e instanceof RuntimeError) throw e;
            throw new RuntimeError(`Blaxel spawn failed: ${e.message}`, 502);
        }
    }

    async exec(cmd, args, env, options) {
        const sandboxName = options?.runtimeRef;
        if (!sandboxName) throw new RuntimeError('runtimeRef required for exec', 400);

        try {
            const sandbox = await this._getSandbox(sandboxName);
            const argv = [cmd, ...(args || [])];
            const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
            const maxWaitMs = options?.timeoutMs || 30_000;
            const result = await sandbox.process.exec({
                command: argv.map(q).join(' '),
                env: env || {},
                workingDir: options?.cwd || undefined,
                waitForCompletion: true,
            });

            // The server waits synchronously for completion; if the edge gave up
            // early (status still running), poll until done or timeout.
            let exitCode = result?.exitCode ?? 0;
            let stdout = result?.stdout || '';
            let stderr = result?.stderr || '';
            const processId = processIdentifier(result);
            if (result?.status === 'running' && processId) {
                const deadline = Date.now() + maxWaitMs;
                for (;;) {
                    await new Promise((r) => setTimeout(r, 500));
                    let done = false;
                    try {
                        const info = await sandbox.process.get(processId);
                        if (info && TERMINAL_STATUSES.has(info.status)) {
                            exitCode = info.exitCode || 0;
                            stdout = info.stdout || stdout;
                            stderr = info.stderr || stderr;
                            done = true;
                        }
                    } catch (_) {
                        done = true;
                    }
                    if (done || Date.now() >= deadline) break;
                }
            }

            return { exitCode, stdout, stderr };
        } catch (e) {
            if (e instanceof RuntimeError) throw e;
            throw new RuntimeError(`Blaxel exec failed: ${e.message}`, 502);
        }
    }
}

module.exports = BlaxelExecAdapter;
module.exports.BlaxelStreamHandle = BlaxelStreamHandle;
