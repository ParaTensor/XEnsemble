/**
 * 执行面接口定义 — 所有 Runtime Provider 须实现这些基类。
 * 对齐 Architecture.md 3.1 节。
 */

class RuntimeError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.name = 'RuntimeError';
        this.statusCode = statusCode;
    }
}

class AgentSpawnError extends RuntimeError {
    constructor(message, statusCode = 400) {
        super(message, statusCode);
        this.name = 'AgentSpawnError';
    }
}

// ─── StreamHandle：spawn 返回的统一句柄，SessionManager 仅依赖此接口 ───

class StreamHandle {
    /**
     * @param {function(string, number | undefined): void} callback
     * @returns {{ dispose(): void }}
     */
    onData(callback) { throw new Error('StreamHandle.onData not implemented'); }
    /** @param {function({exitCode, signal}): void} callback */
    onExit(callback) { throw new Error('StreamHandle.onExit not implemented'); }
    write(data) { throw new Error('StreamHandle.write not implemented'); }
    resize(cols, rows) { throw new Error('StreamHandle.resize not implemented'); }
    kill() { throw new Error('StreamHandle.kill not implemented'); }
    get pid() { throw new Error('StreamHandle.pid not implemented'); }
    /** Provider 内 PTY stream 标识，用于 sessions.stream_ref / attachSession */
    get streamRef() { return null; }
    async getMetrics() { return { cpu: 0, memory: 0 }; }
}

// ─── RuntimeProvider：runtime 生命周期 ───

class RuntimeProvider {
    /**
     * 幂等 provision / attach / restore；返回 { runtimeRef, workspacePath }。
     * opts 可包含 runtimeId、baseSnapshotId、checkpointId。
     * 必须并发安全（singleflight），见 Architecture.md 3.1。
     */
    async ensureReady(project, opts = {}) {
        throw new Error('RuntimeProvider.ensureReady not implemented');
    }
    async attach(runtimeRef) { throw new Error('RuntimeProvider.attach not implemented'); }
    async attachSession(sessionId, streamRef) { throw new Error('RuntimeProvider.attachSession not implemented'); }
    async destroy(runtimeRef) { throw new Error('RuntimeProvider.destroy not implemented'); }
    async metrics(runtimeRef) { throw new Error('RuntimeProvider.metrics not implemented'); }
    supportsHibernate() { return false; }
    async hibernate(runtimeRef) { throw new Error('RuntimeProvider.hibernate not implemented'); }
}

// ─── ExecAdapter：命令执行 ───

class ExecAdapter {
    /** @returns {Promise<StreamHandle>} */
    async spawn(cmd, args, env, options) { throw new Error('ExecAdapter.spawn not implemented'); }
    async exec(cmd, args, env, options) { throw new Error('ExecAdapter.exec not implemented'); }
}

// ─── FsAdapter：受控文件读写 ───

class FsAdapter {
    async fsList(rootDir, relativePath, opts = {}) { throw new Error('FsAdapter.fsList not implemented'); }
    async fsRead(rootDir, relativePath, opts = {}) { throw new Error('FsAdapter.fsRead not implemented'); }
}

// ─── PreviewAdapter：预览进程 ───

class PreviewAdapter {
    async startPreview(project, contract) { throw new Error('PreviewAdapter.startPreview not implemented'); }
    async stopPreview(deployment) { throw new Error('PreviewAdapter.stopPreview not implemented'); }
}

module.exports = {
    RuntimeError,
    AgentSpawnError,
    StreamHandle,
    RuntimeProvider,
    ExecAdapter,
    FsAdapter,
    PreviewAdapter,
};
