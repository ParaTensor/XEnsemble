// 仅 Local 有效：本地 node-pty 命令执行与 StreamHandle 实现。
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const { ExecAdapter, AgentSpawnError, StreamHandle } = require('./interfaces');
const { getProcessStats } = require('./Monitor');
const { resolveExecutable, enrichPath, KNOWN_CLI_LOCATIONS } = require('../agents/agentProbe');

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
        : '';
    return `Cannot start agent ${label}: found executable at ${resolved} but failed to open a PTY (${cause}).` +
        ` Run \`${path.basename(resolved)} --help\` in your terminal to verify the CLI.${argsHint}`;
}

function resolveSpawnTarget(resolved, args) {
    if (process.platform === 'win32') {
        return { command: resolved, args: [...args] };
    }
    const shell = process.env.SHELL || '/bin/zsh';
    const commandLine = `exec ${[resolved, ...args].map(quotePosixArg).join(' ')}`;
    return { command: shell, args: ['-il', '-c', commandLine] };
}

// ─── LocalStreamHandle：封装 node-pty，隐藏 Local 细节 ───

class LocalStreamHandle extends StreamHandle {
    constructor(ptyProcess) {
        super();
        this._pty = ptyProcess;
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
            setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch (e) { /* ignore */ } }, 2000);
        }
        this._pty.kill();
    }

    get pid() {
        return this._pty.pid;
    }

    get streamRef() {
        const pid = this._pty.pid;
        return Number.isInteger(pid) && pid > 0 ? `local:pty:${pid}` : null;
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
     * @param {{ cwd: string, name?: string }} options
     * @returns {LocalStreamHandle}
     */
    spawn(cmd, args, env, options = {}) {
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
            TERM: 'xterm-256color',
        };

        const resolved = resolveExecutable(cmd, spawnEnv);
        if (!resolved) {
            throw new AgentSpawnError(buildNotFoundMessage(cmd, options.name));
        }

        const { command, args: spawnArgs } = resolveSpawnTarget(resolved, args);
        const ptyOptions = {
            name: 'xterm-256color',
            cols: 120,
            rows: 32,
            cwd: workspaceDir,
            env: spawnEnv,
        };

        try {
            const ptyProcess = pty.spawn(command, spawnArgs, ptyOptions);
            return new LocalStreamHandle(ptyProcess);
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
        throw new Error('LocalExecAdapter.exec not yet implemented');
    }
}

module.exports = LocalExecAdapter;
