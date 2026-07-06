// 仅 Local 有效：本地文件系统 runtime 生命周期管理。
const { RuntimeProvider } = require('./interfaces');
const workspace = require('../workspace');
const { resolveRuntimeProvider } = require('../config/runtimeProvider');

class LocalRuntimeProvider extends RuntimeProvider {
    /**
     * 幂等：确保 project workspace 目录存在并返回路径。
     * @param {{ userId: string, id: string }} project
     * @returns {Promise<{ runtimeRef: string, workspacePath: string }>}
     */
    async ensureReady(project, opts = {}) {
        const workspacePath = workspace.createProjectDirectory(project.userId, project.id);
        if (resolveRuntimeProvider() === 'local') {
            const { ensureAgentBootstrap } = require('../workspace/agentBootstrap');
            await ensureAgentBootstrap(project, workspacePath);
        }
        return { runtimeRef: 'local', workspacePath };
    }

    async attach(runtimeRef) {
        return { runtimeRef, recoverable: false };
    }

    supportsHibernate() {
        return false;
    }

    async attachSession(sessionId, streamRef) {
        const { readScrollback } = require('./LocalScrollbackBuffer');
        const scrollback = readScrollback(streamRef);
        // For local execution, reattachment to a still-running PTY is not supported across server restarts.
        // Return scrollback so the client can replay history; mark recoverable=false.
        return { scrollback, recoverable: false };
    }

    async destroy(runtimeRef) {
        // Local 模式不删除 workspace 目录
    }

    async hibernate(runtimeRef) {
        return { supported: false };
    }

    async metrics(runtimeRef) {
        return { cpu: 0, memory: 0 };
    }
}

module.exports = LocalRuntimeProvider;
