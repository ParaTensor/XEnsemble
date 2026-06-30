const { RuntimeProvider, RuntimeError } = require('./interfaces');
const BoxLiteClient = require('./BoxLiteClient');

class BoxLiteRuntimeProvider extends RuntimeProvider {
    constructor() {
        super();
        this.client = new BoxLiteClient();
    }

    async ensureReady(project, opts = {}) {
        const runtimeId = opts && opts.runtimeId ? opts.runtimeId : null;
        const name = runtimeId || `p_${project.id}`;
        const image = opts.image || process.env.BLINK_IMAGE || undefined;
        const warm = !!opts.warm;
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
        return { runtimeRef: name, workspacePath: '/workspace' };
    }

    async attach(runtimeRef) {
        return { runtimeRef, recoverable: false };
    }

    async attachSession(sessionId, streamRef) {
        return { scrollback: '', recoverable: false };
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
