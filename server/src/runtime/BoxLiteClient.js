const WebSocket = require('ws');
const { StringDecoder } = require('string_decoder');

function decodeExecutionFrameRaw(buf, seqFramed = true) {
    const channel = buf.length > 0 ? buf[0] : undefined;
    if (!seqFramed) {
        return {
            channel,
            payload: buf.length > 1 ? buf.slice(1) : Buffer.alloc(0),
            rseq: undefined,
        };
    }

    if (buf.length < 9) {
        return {
            channel,
            payload: Buffer.alloc(0),
            rseq: undefined,
        };
    }

    return {
        channel,
        payload: buf.slice(9),
        rseq: Number(buf.readBigUInt64BE(1)),
    };
}

function decodeExecutionFrame(buf, seqFramed = true) {
    const { channel, payload, rseq } = decodeExecutionFrameRaw(buf, seqFramed);
    return {
        channel,
        payload: payload.toString('utf8'),
        rseq,
    };
}

class BoxLiteClient {
    constructor() {
        this.base = (process.env.BLINK_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
    }

    parseExecutionStreamRef(streamRef) {
        const match = /^boxlite:([^:]+):([^:]+)$/.exec(String(streamRef || ''));
        if (!match) return null;
        return { sessionName: match[1], execId: match[2] };
    }

    buildExecutionAttachUrl(sessionName, execId, options = {}) {
        const url = new URL(
            `${this.base}/api/sessions/${encodeURIComponent(sessionName)}/executions/${encodeURIComponent(execId)}/attach`
        );
        if (options.seq != null) {
            url.searchParams.set('seq', String(options.seq));
        }
        if (options.after != null) {
            url.searchParams.set('after', String(options.after));
        }
        return `${url.pathname}${url.search}`;
    }

    createExecutionAttachWebSocket(sessionName, execId, options = {}) {
        const attachUrl = this.buildExecutionAttachUrl(sessionName, execId, options);
        const wsUrl = this.base.replace(/^http/, 'ws') + attachUrl;
        return new WebSocket(wsUrl);
    }

    createExecutionAttachWebSocketFromStreamRef(streamRef, options = {}) {
        const parsed = this.parseExecutionStreamRef(streamRef);
        if (!parsed) {
            throw new Error(`Invalid BoxLite streamRef: ${streamRef}`);
        }
        return this.createExecutionAttachWebSocket(parsed.sessionName, parsed.execId, options);
    }

    async health() {
        const res = await fetch(`${this.base}/api/health`);
        if (!res.ok) throw new Error(`blink health ${res.status}`);
        return res.json();
    }

    async product() {
        const res = await fetch(`${this.base}/api/product`);
        if (!res.ok) return {};
        return res.json();
    }

    async openSession(name, image, warm = false, options = {}) {
        const body = { name };
        if (image) body.image = image;
        if (warm) body.warm = true;
        if (Array.isArray(options.volumes) && options.volumes.length > 0) {
            body.volumes = options.volumes.map((volume) => ({
                host_path: volume.host_path,
                guest_path: volume.guest_path,
                read_only: !!volume.read_only,
            }));
        }
        if (options.network) {
            body.network = {
                mode: options.network.mode || 'enabled',
                allow_net: Array.isArray(options.network.allow_net) ? options.network.allow_net : [],
            };
        }
        if (options.resources && Object.keys(options.resources).length > 0) {
            body.resources = options.resources;
        }
        const res = await fetch(`${this.base}/api/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`open session failed: ${res.status} ${t}`);
        }
        return res.json();
    }

    async getSessionStatus(name) {
        const res = await fetch(`${this.base}/api/sessions/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        return data?.session || null;
    }

    async deleteSession(name) {
        if (!name) return;
        await this.stopSession(name).catch(() => {});
        const res = await fetch(`${this.base}/api/sessions/${encodeURIComponent(name)}`, {
            method: 'DELETE',
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`delete session failed: ${res.status} ${t}`);
        }
    }

    async stopSession(name) {
        if (!name) return;
        const res = await fetch(`${this.base}/api/sessions/${encodeURIComponent(name)}/stop`, {
            method: 'POST',
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`stop session failed: ${res.status} ${t}`);
        }
        return res.json().catch(() => ({}));
    }

    async spawn(sessionName, spec) {
        const res = await fetch(`${this.base}/api/sessions/${encodeURIComponent(sessionName)}/spawn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(spec || {}),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`spawn failed: ${res.status} ${t}`);
        }
        return res.json();
    }

    createAttachWebSocket(attachUrl) {
        const wsUrl = this.base.replace(/^http/, 'ws') + attachUrl;
        return new WebSocket(wsUrl);
    }

    async execForResult(sessionName, command, args = [], env = {}, workingDir = null) {
        const spec = {
            command,
            args: args || [],
            env: env || {},
            tty: false,
            working_dir: workingDir || undefined,
        };
        const spawned = await this.spawn(sessionName, spec);
        const ws = this.createExecutionAttachWebSocket(sessionName, spawned.execution_id, { seq: 1, after: 0 });
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            const decoders = { 0x01: new StringDecoder('utf8'), 0x02: new StringDecoder('utf8') };
            const done = (code) => {
                if (settled) return;
                settled = true;
                stdout += decoders[0x01].end();
                stderr += decoders[0x02].end();
                try { ws.close(); } catch (_) {}
                resolve({ exitCode: code ?? 0, stdout, stderr });
            };
            ws.on('message', (data, isBinary) => {
                if (isBinary) {
                    const buf = Buffer.from(data);
                    const decoded = decodeExecutionFrameRaw(buf, true);
                    if (decoded.channel === 0x01) stdout += decoders[0x01].write(decoded.payload);
                    else if (decoded.channel === 0x02) stderr += decoders[0x02].write(decoded.payload);
                } else {
                    try {
                        const msg = JSON.parse(data.toString());
                        if (msg.type === 'exit') {
                            done(msg.exit_code);
                        } else if (msg.type === 'error') {
                            if (!settled) {
                                settled = true;
                                try { ws.close(); } catch (_) {}
                                reject(new Error(msg.message || 'blink exec error'));
                            }
                        }
                    } catch (_) {}
                }
            });
            ws.on('error', (e) => {
                if (!settled) {
                    settled = true;
                    reject(e);
                }
            });
            ws.on('close', () => done(-1));
            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    try { ws.close(); } catch (_) {}
                    resolve({ exitCode: -1, stdout, stderr });
                }
            }, 120000);
        });
    }

    async createCheckpoint(name, snapshot) {
        const res = await fetch(`${this.base}/api/sessions/${encodeURIComponent(name)}/checkpoints`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot: snapshot || `snap_${Date.now()}` }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`checkpoint failed: ${res.status} ${t}`);
        }
        return res.json();
    }

    async restoreCheckpoint(name, snapshot) {
        const res = await fetch(`${this.base}/api/sessions/${encodeURIComponent(name)}/checkpoints/${encodeURIComponent(snapshot)}/restore`, {
            method: 'POST',
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`restore failed: ${res.status} ${t}`);
        }
        return res.json();
    }

    async exportSession(name) {
        const res = await fetch(`${this.base}/api/sessions/${encodeURIComponent(name)}/export`, { method: 'POST' });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`export failed: ${res.status} ${t}`);
        }
        return res.json();
    }

    async importSession(archiveBuffer, suggestedName = null) {
        const form = new FormData();
        const fname = suggestedName || 'import.boxlite';
        const blob = new Blob([Buffer.from(archiveBuffer)]);
        form.append('archive', blob, fname);
        if (suggestedName) {
            form.append('name', suggestedName);
        }
        const res = await fetch(`${this.base}/api/import`, {
            method: 'POST',
            body: form,
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`import failed: ${res.status} ${t}`);
        }
        return res.json();
    }
}

module.exports = BoxLiteClient;
module.exports.decodeExecutionFrame = decodeExecutionFrame;
module.exports.decodeExecutionFrameRaw = decodeExecutionFrameRaw;
