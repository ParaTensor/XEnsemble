const { RuntimeProvider, RuntimeError } = require('./interfaces');
const { SandboxInstance } = require('@blaxel/core');
const workspace = require('../workspace');

function getBlaxelConfig() {
    return {
        workspace: process.env.BL_WORKSPACE || '',
        apiKey: process.env.BL_API_KEY || '',
        region: process.env.BL_REGION || 'us-pdx-1',
    };
}

function sandboxName(project) {
    return `xe-${project.userId}-${project.id}`.slice(0, 64);
}

class BlaxelRuntimeProvider extends RuntimeProvider {
    constructor() {
        super();
        this._config = getBlaxelConfig();
        if (this._config.apiKey) {
            this._ensureInitialized();
        }
    }

    async _ensureInitialized() {
        try {
            const { initialize } = require('@blaxel/core');
            await initialize();
        } catch (_) {
            // Already initialized or not needed
        }
    }

    workspacePath() {
        return process.env.XENSEMBLE_WORKSPACE_PATH
            || process.env.WORKSPACE_PATH
            || '/workspace';
    }

    hostWorkspacePath(project) {
        return workspace.projectDir(project.userId, project.id);
    }

    async ensureReady(project, opts = {}) {
        const name = opts.runtimeId || sandboxName(project);
        const image = opts.image || process.env.BLAXEL_SANDBOX_IMAGE || 'blaxel/base-image:latest';
        const memory = parseInt(process.env.BLAXEL_SANDBOX_MEMORY || '4096', 10);

        let sandbox;
        try {
            sandbox = await SandboxInstance.get(name);
        } catch {
            sandbox = null;
        }

        if (!sandbox) {
            try {
                sandbox = await SandboxInstance.createIfNotExists({
                    name,
                    image,
                    memory,
                    region: this._config.region,
                    labels: { project_id: project.id, user_id: project.userId },
                });
            } catch (e) {
                throw new RuntimeError(`Blaxel sandbox creation failed: ${e.message}`, 502);
            }
        }

        // Ensure workspace directory exists
        const wp = this.workspacePath();
        try {
            await sandbox.filesystem.putDirectory({
                path: wp,
                body: '',
                createParents: true,
            });
        } catch (_) {
            // Directory may already exist, that's fine
        }

        return {
            runtimeRef: name,
            workspacePath: wp,
        };
    }

    async attach(runtimeRef) {
        const sandbox = await SandboxInstance.get(runtimeRef);
        if (!sandbox) throw new RuntimeError('Blaxel sandbox not found', 404);
        return sandbox;
    }

    async attachSession(sessionId, streamRef) {
        return this.attach(streamRef);
    }

    async destroy(runtimeRef) {
        try {
            const sandbox = await SandboxInstance.get(runtimeRef);
            if (sandbox) await sandbox.delete();
        } catch (e) {
            // Ignore errors during cleanup
        }
    }

    async metrics(runtimeRef) {
        try {
            const sandbox = await SandboxInstance.get(runtimeRef);
            return {
                cpu: 0,
                memory: sandbox?.memory || 0,
                status: sandbox?.status || 'unknown',
            };
        } catch {
            return { cpu: 0, memory: 0, status: 'unknown' };
        }
    }

    supportsHibernate() {
        return true;
    }

    async hibernate(runtimeRef) {
        // Blaxel handles standby automatically
    }
}

module.exports = BlaxelRuntimeProvider;
