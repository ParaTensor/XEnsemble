// 仅 Local 有效：本地 node-pty 命令执行与 StreamHandle 实现。
const { spawn } = require('child_process');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ExecAdapter, AgentSpawnError, StreamHandle } = require('./interfaces');
const { getProcessStats } = require('./Monitor');
const { resolveExecutable, enrichPath, KNOWN_CLI_LOCATIONS } = require('../agents/agentProbe');
const { loadRuntimeLimits, wrapForLimits } = require('./LocalRuntimeLimits');

const runtimeLimits = loadRuntimeLimits();

// ─── 辅助函数（原 Executor.js） ───

function quotePosixArg(input) {
    if (input.length === 0) return "''";
    if (!/[\s'"\\$`\n\r\t;&|<>(){}[\]*?!]/.test(input)) return input;
    return `'${input.replace(/'/g, "'\\''")}'`;
}

function isExecutable(filePath) {
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return fs.existsSync(filePath);
    }
}

function findOffPathInstall(cmd) {
    const home = process.env.HOME;
    if (!home) return null;
    const relPaths = KNOWN_CLI_LOCATIONS[cmd] || [];
    for (const rel of relPaths) {
        const full = path.join(home, rel);
        if (isExecutable(full)) return full;
    }
    return null;
}

function buildNotFoundMessage(cmd, agentName) {
    const label = agentName ? `"${agentName}"` : `"${cmd}"`;
    const offPath = findOffPathInstall(cmd);
    const pathPreview = (process.env.PATH || '(empty)')
        .split(path.delimiter)
        .filter(Boolean)
        .slice(0, 6)
        .join(path.delimiter);
    const pathSuffix = (process.env.PATH || '').split(path.delimiter).length > 6 ? `${path.delimiter}…` : '';

    let message = `Cannot start agent ${label}: command "${cmd}" was not found in the backend server PATH.`;
    if (offPath) {
        message += ` The CLI exists at ${offPath} but the server cannot see it. In Agents admin set cmd to that full path, or restart the backend after exporting PATH to include ${path.dirname(offPath)}.`;
    } else {
        message += ` Install the "${cmd}" CLI on this machine, or set cmd to its absolute path in Agents admin.`;
    }
    message += ` Server PATH (preview): ${pathPreview}${pathSuffix}`;
    return message;
}

function parseId(value) {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return undefined;
    return n;
}

function getSpawnHelperPath() {
    const archDir = process.platform === 'darwin'
        ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
        : null;
    if (!archDir) return null;
    return path.join(__dirname, '../../node_modules/node-pty/prebuilds', archDir, 'spawn-helper');
}

function getSpawnHelperFixHint() {
    const helper = getSpawnHelperPath();
    if (!helper || !fs.existsSync(helper)) return null;
    if (isExecutable(helper)) return null;
    return `node-pty spawn-helper is missing the execute bit (${helper}). ` +
        `From the server folder run: chmod +x node_modules/node-pty/prebuilds/*/spawn-helper, then restart the backend. ` +
        `Future npm install runs postinstall to fix this automatically.`;
}

function buildPosixSpawnFailedMessage(cmd, agentName, resolved, cause) {
    const label = agentName ? `"${agentName}"` : `"${cmd}"`;
    const spawnHelperHint = getSpawnHelperFixHint();
    if (spawnHelperHint) {
        return `Cannot start agent ${label}: terminal backend is misconfigured (${cause}). ${spawnHelperHint}`;
    }
    const argsHint = cmd === 'kimi'
        ? ' Kimi Code no longer supports `--mode agent`; set args to [] in Agents admin (interactive CLI).'
        : cmd === 'claude'
            ? ' Claude Code no longer supports `--not-interactive`; set args to [] in Agents admin.'
            : cmd === 'agent' || cmd === 'cursor-agent'
                ? ' Use command `agent` (Cursor Agent CLI), not the `cursor` editor binary.'
                : cmd === 'droid'
                    ? ' Droid has no `start` subcommand; set args to [] for interactive mode.'
                    : cmd === 'hermes'
                        ? ' Hermes gateway mode uses OPENROUTER_API_KEY + OPENROUTER_BASE_URL; launch args should include --ignore-user-config --provider openrouter.'
                        : '';
    return `Cannot start agent ${label}: found executable at ${resolved} but failed to open a PTY (${cause}).` +
        ` Run \`${path.basename(resolved)} --help\` in your terminal to verify the CLI.${argsHint}`;
}

function resolveSpawnTarget(resolved, args, pathEnv) {
    if (process.platform === 'win32') {
        return { command: resolved, args: [...args] };
    }
    const shell = process.env.SHELL || '/bin/zsh';
    // Explicitly set PATH before exec so the interpreter (e.g. /usr/bin/env node)
    // can find runtimes even if the shell resets the environment.
    const pathExport = pathEnv ? `PATH=${quotePosixArg(pathEnv)} ` : '';
    const commandLine = `${pathExport}exec ${[resolved, ...args].map(quotePosixArg).join(' ')}`;
    // Use interactive but not login shell: login shell (-l) resets PATH from
    // /etc/profile and can break Node CLIs installed via nvm/other prefixes.
    return { command: shell, args: ['-i', '-c', commandLine] };
}

// ─── LocalStreamHandle：封装 node-pty，隐藏 Local 细节 ───

class LocalStreamHandle extends StreamHandle {
    constructor(ptyProcess, streamRef) {
        super();
        this._pty = ptyProcess;
        this._streamRef = streamRef;
        this._exited = false;
        this._killFallback = null;
        const { appendScrollback } = require('./LocalScrollbackBuffer');
        ptyProcess.onData((data) => appendScrollback(streamRef, data));
        this._pty.onExit(() => {
            this._exited = true;
            if (this._killFallback) {
                clearTimeout(this._killFallback);
                this._killFallback = null;
            }
        });
    }

    onData(callback) {
        return this._pty.onData(callback);
    }

    onExit(callback) {
        return this._pty.onExit(callback);
    }

    write(data) {
        this._pty.write(data);
    }

    resize(cols, rows) {
        this._pty.resize(cols, rows);
    }

    kill() {
        const pid = this._pty.pid;
        if (process.platform !== 'win32' && Number.isInteger(pid) && pid > 0) {
            try { process.kill(-pid, 'SIGTERM'); } catch (e) { /* ignore */ }
            if (this._killFallback) {
                clearTimeout(this._killFallback);
                this._killFallback = null;
            }
            this._killFallback = setTimeout(() => {
                if (!this._exited) {
                    try { process.kill(-pid, 'SIGKILL'); } catch (e) { /* ignore */ }
                }
            }, 2000);
        }
        this._pty.kill();
    }

    get pid() {
        return this._pty.pid;
    }

    get streamRef() {
        return this._streamRef;
    }

    async getMetrics() {
        if (!this._pty.pid) return { cpu: 0, memory: 0 };
        return getProcessStats(this._pty.pid);
    }
}

// ─── LocalExecAdapter ───

class LocalExecAdapter extends ExecAdapter {
    /**
     * @param {string} cmd
     * @param {string[]} args
     * @param {object} env
     * @param {{ cwd: string, name?: string, uid?: number, gid?: number }} options
     * @returns {Promise<LocalStreamHandle>}
     */
    async spawn(cmd, args, env, options = {}) {
        const workspaceDir = options.cwd;
        if (!workspaceDir || typeof workspaceDir !== 'string') {
            throw new AgentSpawnError('Project workspace directory is required to start an agent.');
        }
        if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
        }

        const spawnEnv = {
            ...process.env,
            ...env,
            PATH: enrichPath({ ...process.env, ...env }),
            TERM: env.TERM || process.env.TERM || 'xterm-256color',
        };

        const resolved = resolveExecutable(cmd, spawnEnv);
        if (!resolved) {
            throw new AgentSpawnError(buildNotFoundMessage(cmd, options.name));
        }

        const { command: targetCommand, args: spawnArgs } = resolveSpawnTarget(resolved, args, spawnEnv.PATH);
        const ptyOptions = {
            name: 'xterm-256color',
            cols: 120,
            rows: 32,
            cwd: workspaceDir,
            env: spawnEnv,
            uid: parseId(options.uid),
            gid: parseId(options.gid),
        };

        const {
            command,
            args: finalArgs,
            options: finalOptions,
        } = wrapForLimits(targetCommand, spawnArgs, ptyOptions, runtimeLimits);

        try {
            const ptyProcess = pty.spawn(command, finalArgs, finalOptions);
            const streamRef = `local:pty:${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${ptyProcess.pid}`;
            return new LocalStreamHandle(ptyProcess, streamRef);
        } catch (err) {
            const cause = err instanceof Error ? err.message : String(err);
            if (/posix_spawnp failed|ENOENT|not found/i.test(cause)) {
                throw new AgentSpawnError(
                    buildPosixSpawnFailedMessage(cmd, options.name, resolved, cause),
                    500
                );
            }
            const label = options.name ? `"${options.name}"` : `"${cmd}"`;
            throw new AgentSpawnError(
                `Cannot start agent ${label}: failed to run "${resolved}" (${cause}).`,
                500
            );
        }
    }

    async exec(cmd, args, env, options = {}) {
        const workspaceDir = options.cwd;
        if (!workspaceDir || typeof workspaceDir !== 'string') {
            throw new AgentSpawnError('Project workspace directory is required to run a command.');
        }
        if (!fs.existsSync(workspaceDir)) {
            fs.mkdirSync(workspaceDir, { recursive: true });
        }

        const spawnEnv = {
            ...process.env,
            ...env,
            PATH: enrichPath({ ...process.env, ...env }),
        };

        return new Promise((resolve, reject) => {
            const maxBuffer = options.maxBuffer || 2 * 1024 * 1024;

            const execOptions = {
                cwd: workspaceDir,
                env: spawnEnv,
                timeout: options.timeoutMs || 60_000,
                maxBuffer,
                uid: parseId(options.uid),
                gid: parseId(options.gid),
            };
            const {
                command,
                args: finalArgs,
                options: finalOptions,
            } = wrapForLimits(cmd, args, execOptions, runtimeLimits);
            const child = spawn(command, finalArgs, finalOptions);

            let stdout = '';
            let stderr = '';
            let totalLength = 0;
            let killedForBuffer = false;

            child.stdout?.on('data', (chunk) => {
                stdout += chunk;
                totalLength += chunk.length;
                if (totalLength > maxBuffer && !killedForBuffer) {
                    killedForBuffer = true;
                    child.kill('SIGTERM');
                }
            });
            child.stderr?.on('data', (chunk) => {
                stderr += chunk;
                totalLength += chunk.length;
                if (totalLength > maxBuffer && !killedForBuffer) {
                    killedForBuffer = true;
                    child.kill('SIGTERM');
                }
            });

            child.on('error', (err) => {
                reject(new AgentSpawnError(`Failed to run command: ${err.message}`, 500));
            });

            child.on('close', (code, signal) => {
                if (killedForBuffer) {
                    reject(new AgentSpawnError('Command output exceeded maxBuffer', 504));
                    return;
                }
                if (signal) {
                    reject(new AgentSpawnError(`Command killed by ${signal}`, 504));
                    return;
                }
                resolve({
                    exitCode: code ?? 0,
                    stdout: stdout.slice(0, options.maxOutput || 1024 * 1024),
                    stderr: stderr.slice(0, options.maxOutput || 1024 * 1024),
                });
            });
        });
    }
}

module.exports = LocalExecAdapter;
module.exports.parseId = parseId;
