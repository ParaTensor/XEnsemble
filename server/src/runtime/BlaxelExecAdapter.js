const { ExecAdapter, RuntimeError, StreamHandle } = require('./interfaces');
const { SandboxInstance, postProcess, getProcessByIdentifier } = require('@blaxel/core');

class BlaxelStreamHandle extends StreamHandle {
    constructor(processId, sandboxName) {
        super();
        this._processId = processId;
        this._sandboxName = sandboxName;
        this._dataCbs = [];
        this._exitCbs = [];
        this._closed = false;
        this._pollTimer = null;
    }

    onData(callback) {
        this._dataCbs.push(callback);
        this._startPolling();
        return { dispose: () => { this._dataCbs = this._dataCbs.filter((c) => c !== callback); } };
    }

    onExit(callback) {
        this._exitCbs.push(callback);
        return { dispose: () => { this._exitCbs = this._exitCbs.filter((c) => c !== callback); } };
    }

    write(data) {
        // Blaxel processes are non-interactive by default; write not supported in basic impl
    }

    resize(cols, rows) {
        // Blaxel processes don't support resize in basic impl
    }

    kill() {
        this._closed = true;
        this._stopPolling();
    }

    get pid() { return this._processId; }
    get streamRef() { return `blaxel:${this._sandboxName}:${this._processId}`; }

    _startPolling() {
        if (this._pollTimer) return;
        this._pollTimer = setInterval(async () => {
            if (this._closed) { this._stopPolling(); return; }
            try {
                const info = await getProcessByIdentifier({
                    sandbox: this._sandboxName,
                    identifier: this._processId,
                });
                if (info && info.status === 'exited') {
                    this._closed = true;
                    this._stopPolling();
                    for (const cb of this._exitCbs) {
                        cb({ exitCode: info.exitCode || 0, signal: null });
                    }
                }
            } catch (_) {
                // Process might not exist anymore
            }
        }, 2000);
    }

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }
}

class BlaxelExecAdapter extends ExecAdapter {
    constructor() {
        super();
    }

    async _getSandbox(name) {
        return SandboxInstance.get(name);
    }

    async spawn(cmd, args, env, options) {
        const sandboxName = options?.runtimeRef;
        if (!sandboxName) throw new RuntimeError('runtimeRef required for spawn', 400);

        try {
            const result = await postProcess({
                sandbox: sandboxName,
                body: {
                    command: cmd,
                    args: args || [],
                    env: env || {},
                },
            });

            const handle = new BlaxelStreamHandle(result.id || result.processId, sandboxName);
            return handle;
        } catch (e) {
            throw new RuntimeError(`Blaxel spawn failed: ${e.message}`, 502);
        }
    }

    async exec(cmd, args, env, options) {
        const sandboxName = options?.runtimeRef;
        if (!sandboxName) throw new RuntimeError('runtimeRef required for exec', 400);

        try {
            const result = await postProcess({
                sandbox: sandboxName,
                body: {
                    command: cmd,
                    args: args || [],
                    env: env || {},
                },
            });

            // Wait for process to complete
            const processId = result.id || result.processId;
            let exitCode = 0;
            let stdout = '';
            let stderr = '';

            // Poll for completion
            for (let i = 0; i < 300; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                try {
                    const info = await getProcessByIdentifier({
                        sandbox: sandboxName,
                        identifier: processId,
                    });
                    if (info && info.status === 'exited') {
                        exitCode = info.exitCode || 0;
                        stdout = info.stdout || '';
                        stderr = info.stderr || '';
                        break;
                    }
                } catch (_) {
                    break;
                }
            }

            return { exitCode, stdout, stderr };
        } catch (e) {
            throw new RuntimeError(`Blaxel exec failed: ${e.message}`, 502);
        }
    }
}

module.exports = BlaxelExecAdapter;
