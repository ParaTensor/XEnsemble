// 仅 Local 有效：本地文件系统 runtime 生命周期管理。
const { RuntimeProvider } = require('./interfaces');
const workspace = require('../workspace');

class LocalRuntimeProvider extends RuntimeProvider {
    /**
     * 幂等：确保 project workspace 目录存在并返回路径。
     * @param {{ userId: string, id: string }} project
     * @returns {Promise<{ runtimeRef: string, workspacePath: string }>}
     */
    async ensureReady(project, opts = {}) {
        const workspacePath = workspace.createProjectDirectory(project.userId, project.id);
        return { runtimeRef: 'local', workspacePath };
    }

    async attach(runtimeRef) {
        return { runtimeRef, recoverable: false };
    }

    async destroy(runtimeRef) {
        // Local 模式不删除 workspace 目录
    }

    async metrics(runtimeRef) {
        return { cpu: 0, memory: 0 };
    }
}

module.exports = LocalRuntimeProvider;
