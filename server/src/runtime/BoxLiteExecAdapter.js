const { ExecAdapter, AgentSpawnError, StreamHandle } = require('./interfaces');
const BoxLiteClient = require('./BoxLiteClient');

class BoxLiteStreamHandle extends StreamHandle {
    constructor(ws, streamRef) {
        super();
        this._ws = ws;
        this._streamRef = streamRef;
        this._dataCbs = [];
        this._exitCbs = [];
        this._closed = false;

        ws.on('message', (data, isBinary) => {
            if (isBinary) {
                const buf = Buffer.from(data);
                const ch = buf[0];
                const text = buf.slice(1).toString('utf8');
                const payload = text;
                for (const cb of this._dataCbs) {
                    try { cb(payload); } catch (_) {}
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
        const spec = {
            command: String(cmd || 'sh'),
            args: Array.isArray(args) ? args : [],
            env: env || {},
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
        const attachUrl = spawned.attach_url;
        const ws = this.client.createAttachWebSocket(attachUrl);
        const streamRef = `boxlite:${blinkName}:${execId}`;
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('boxlite attach timeout')), 15000);
            ws.once('open', () => { clearTimeout(timer); resolve(); });
            ws.once('error', (e) => { clearTimeout(timer); reject(e); });
        });
        return new BoxLiteStreamHandle(ws, streamRef);
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
