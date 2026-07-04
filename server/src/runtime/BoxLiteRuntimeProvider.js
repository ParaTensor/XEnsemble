const { RuntimeProvider, RuntimeError } = require('./interfaces');
const BoxLiteClient = require('./BoxLiteClient');
const BoxLiteExecAdapter = require('./BoxLiteExecAdapter');
const { BoxLiteStreamHandle } = BoxLiteExecAdapter;

class BoxLiteRuntimeProvider extends RuntimeProvider {
    constructor() {
        super();
        this.client = new BoxLiteClient();
    }

    workspacePath() {
        return process.env.XENSEMBLE_WORKSPACE_PATH
            || process.env.WORKSPACE_PATH
            || '/workspace';
    }

    async ensureWorkspacePath(runtimeRef, workspacePath) {
        const result = await this.client.execForResult(
            runtimeRef,
            'sh',
            ['-lc', `mkdir -p ${JSON.stringify(workspacePath)}`],
            {},
            '/'
        );
        if (result.exitCode !== 0) {
            throw new RuntimeError(`BoxLite ensureReady failed: create workspace path failed with exit code ${result.exitCode}`, 502);
        }
    }

    async ensureReady(project, opts = {}) {
        const runtimeId = opts && opts.runtimeId ? opts.runtimeId : null;
        const name = runtimeId || `p_${project.id}`;
        const image = opts.image || process.env.BLINK_IMAGE || undefined;
        const warm = !!opts.warm;
        const workspacePath = this.workspacePath();
        try {
            await this.client.openSession(name, image, warm);
        } catch (e) {
            if (!/already|exists/i.test(String(e))) {
                throw new RuntimeError(`BoxLite ensureReady failed: ${e.message}`, 502);
            }
        }
        if (opts && (opts.checkpointId || opts.baseSnapshotId)) {
            const snap = opts.checkpointId || opts.baseSnapshotId;
            try {
                await this.client.restoreCheckpoint(name, snap);
            } catch (_) {
                // snapshot may not exist yet or first provision; continue
            }
        }
        await this.ensureWorkspacePath(name, workspacePath);
        return { runtimeRef: name, workspacePath };
    }

    async attach(runtimeRef) {
        return { runtimeRef, recoverable: false };
    }

    async attachSession(sessionId, streamRef, options = {}) {
        const after = Number.isInteger(options.after) && options.after >= 0 ? options.after : 0;
        const ws = this.client.createExecutionAttachWebSocketFromStreamRef(streamRef, { seq: 1, after });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('boxlite attach timeout')), 15000);
            ws.once('open', () => { clearTimeout(timer); resolve(); });
            ws.once('error', (e) => { clearTimeout(timer); reject(e); });
        });
        return new BoxLiteStreamHandle(ws, streamRef, { preferSeqFrames: true });
    }

    async destroy(runtimeRef) {
        await this.client.deleteSession(runtimeRef);
    }

    async metrics(runtimeRef) {
        return { cpu: 0, memory: 0 };
    }

    async checkpoint(runtimeRef, snapshot) {
        if (!runtimeRef) throw new RuntimeError('runtimeRef required for checkpoint', 400);
        return this.client.createCheckpoint(runtimeRef, snapshot);
    }

    async restore(runtimeRef, snapshot) {
        if (!runtimeRef || !snapshot) throw new RuntimeError('runtimeRef and snapshot required for restore', 400);
        return this.client.restoreCheckpoint(runtimeRef, snapshot);
    }

    async export(runtimeRef) {
        if (!runtimeRef) throw new RuntimeError('runtimeRef required for export', 400);
        return this.client.exportSession(runtimeRef);
    }

    async import(archive, name) {
        return this.client.importSession(archive, name);
    }
}

module.exports = BoxLiteRuntimeProvider;
