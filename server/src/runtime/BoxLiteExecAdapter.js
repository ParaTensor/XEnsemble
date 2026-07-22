const { ExecAdapter, AgentSpawnError, StreamHandle } = require('./interfaces');
const BoxLiteClient = require('./BoxLiteClient');
const { decodeExecutionFrameRaw } = BoxLiteClient;
const { StringDecoder } = require('string_decoder');

function quotePosixArg(input) {
    const s = String(input ?? '');
    if (s.length === 0) return "''";
    if (!/[\s'"\\$`\n\r\t;&|<>(){}[\]*?!]/.test(s)) return s;
    return `'${s.replace(/'/g, "'\\''")}'`;
}

class BoxLiteStreamHandle extends StreamHandle {
    constructor(ws, streamRef, options = {}) {
        super();
        this._ws = ws;
        this._streamRef = streamRef;
        this._preferSeqFrames = options.preferSeqFrames !== false;
        this._dataCbs = [];
        this._exitCbs = [];
        this._closed = false;
        this._decoders = {};

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                const buf = Buffer.from(data);
                const decoded = decodeExecutionFrameRaw(buf, this._preferSeqFrames);
                const ch = decoded.channel;
                if (ch !== undefined) {
                    if (!this._decoders[ch]) this._decoders[ch] = new StringDecoder('utf8');
                    var payload = this._decoders[ch].write(decoded.payload);
                    for (const cb of this._dataCbs) {
                        try { cb(payload, decoded.rseq, ch); } catch (_) {}
                    }
                }
            } else {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.type === 'exit') {
                        this._closed = true;
                        for (const cb of this._exitCbs) {
                            try { cb({ exitCode: msg.exit_code ?? 0 }); } catch (_) {}
                        }
                    } else if (msg.type === 'error') {
                        for (const cb of this._dataCbs) {
                            try { cb('\r\n[error: ' + (msg.message || '') + ']\r\n'); } catch (_) {}
                        }
                    }
                } catch (_) {}
            }
        });

        ws.on('close', () => {
            if (!this._closed) {
                this._closed = true;
                for (const cb of this._exitCbs) {
                    try { cb({ exitCode: -1 }); } catch (_) {}
                }
            }
        });
        ws.on('error', () => {
            if (!this._closed) {
                this._closed = true;
                for (const cb of this._exitCbs) {
                    try { cb({ exitCode: -1 }); } catch (_) {}
                }
            }
        });
    }

    onData(callback) {
        this._dataCbs.push(callback);
        return { dispose: () => { this._dataCbs = this._dataCbs.filter((c) => c !== callback); } };
    }

    onExit(callback) {
        this._exitCbs.push(callback);
        return { dispose: () => { this._exitCbs = this._exitCbs.filter((c) => c !== callback); } };
    }

    write(data) {
        if (this._ws && this._ws.readyState === 1) {
            if (typeof data === 'string' || data instanceof Uint8Array) {
                this._ws.send(Buffer.from(data));
            } else {
                this._ws.send(data);
            }
        }
    }

    resize(cols, rows) {
        if (this._ws && this._ws.readyState === 1) {
            try {
                this._ws.send(JSON.stringify({ type: 'resize', rows: Number(rows), cols: Number(cols) }));
            } catch (_) {}
        }
    }

    kill() {
        try {
            if (this._ws && this._ws.readyState === 1) {
                this._ws.send(JSON.stringify({ type: 'signal', signal: 15 }));
                this._ws.close();
            }
        } catch (_) {}
    }

    get pid() { return null; }
    get streamRef() { return this._streamRef; }
    async getMetrics() { return { cpu: 0, memory: 0 }; }
}

class BoxLiteExecAdapter extends ExecAdapter {
    constructor() {
        super();
        this.client = new BoxLiteClient();
    }

    async spawn(cmd, args, env, options = {}) {
        const blinkName = options.runtimeRef || null;
        if (!blinkName) {
            throw new AgentSpawnError('BoxLite spawn requires runtimeRef (blink session name)');
        }
        const working = options.cwd || '/workspace';
        const rawCmd = String(cmd || 'sh');
        const rawArgs = Array.isArray(args) ? args : [];
        const spec = {
            command: rawCmd,
            args: rawArgs,
            env: {
                LANG: 'C.UTF-8',
                LC_ALL: 'C.UTF-8',
                TERM: 'xterm-256color',
                COLUMNS: '120',
                LINES: '32',
                ...env,
            },
            tty: true,
            rows: 32,
            cols: 120,
            working_dir: working,
        };
        let spawned;
        try {
            spawned = await this.client.spawn(blinkName, spec);
        } catch (e) {
            throw new AgentSpawnError('BoxLite spawn failed: ' + e.message);
        }
        const execId = spawned.execution_id;
        const ws = this.client.createExecutionAttachWebSocket(blinkName, execId, { seq: 1, after: 0 });
        const streamRef = `boxlite:${blinkName}:${execId}`;
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('boxlite attach timeout')), 15000);
            ws.once('open', () => { clearTimeout(timer); resolve(); });
            ws.once('error', (e) => { clearTimeout(timer); reject(e); });
        });
        return new BoxLiteStreamHandle(ws, streamRef, { preferSeqFrames: true });
    }

    async reattach(streamRef, options = {}) {
        const parsed = this.client.parseExecutionStreamRef(streamRef);
        if (!parsed) {
            throw new AgentSpawnError(`BoxLite reattach requires boxlite:<name>:<execId> streamRef, got ${streamRef}`);
        }
        const after = Number.isInteger(options.after) && options.after >= 0 ? options.after : 0;
        const ws = this.client.createExecutionAttachWebSocket(parsed.sessionName, parsed.execId, { seq: 1, after });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('boxlite attach timeout')), 15000);
            ws.once('open', () => { clearTimeout(timer); resolve(); });
            ws.once('error', (e) => { clearTimeout(timer); reject(e); });
        });
        return new BoxLiteStreamHandle(ws, streamRef, { preferSeqFrames: true });
    }

    async exec(cmd, args, env, options = {}) {
        const blinkName = options.runtimeRef || null;
        if (!blinkName) {
            throw new AgentSpawnError('BoxLite exec requires runtimeRef');
        }
        const working = options.cwd || '/workspace';
        return this.client.execForResult(blinkName, String(cmd || 'sh'), Array.isArray(args) ? args : [], env || {}, working);
    }
}

module.exports = BoxLiteExecAdapter;
module.exports.BoxLiteStreamHandle = BoxLiteStreamHandle;
