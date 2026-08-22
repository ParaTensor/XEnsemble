const { RuntimeProvider, RuntimeError } = require('./interfaces');
const { SandboxInstance } = require('@blaxel/core');
const workspace = require('../workspace');
const PlatformSettings = require('../admin/PlatformSettings');

async function getBlaxelConfig() {
    const get = async (key, envKey, defaultVal) => {
        const dbVal = await PlatformSettings.get(key);
        if (dbVal) return dbVal;
        return process.env[envKey] || defaultVal || '';
    };

    return {
        workspace: await get('BLAXEL_WORKSPACE', 'BL_WORKSPACE', ''),
        apiKey: await get('BLAXEL_API_KEY', 'BL_API_KEY', ''),
        region: await get('BLAXEL_REGION', 'BL_REGION', 'us-pdx-1'),
        sandboxImage: await get('BLAXEL_SANDBOX_IMAGE', 'BLAXEL_SANDBOX_IMAGE', 'blaxel/base-image:latest'),
        sandboxMemory: parseInt(await get('BLAXEL_SANDBOX_MEMORY', 'BLAXEL_SANDBOX_MEMORY', '4096'), 10),
    };
}

function sandboxName(project) {
    return `xe-${project.userId}-${project.id}`.slice(0, 64);
}

class BlaxelRuntimeProvider extends RuntimeProvider {
    constructor() {
        super();
        this._configPromise = null;
        this._initialized = false;
    }

    async _getConfig() {
        if (!this._configPromise) {
            this._configPromise = getBlaxelConfig().then(async (config) => {
                if (config.apiKey && !this._initialized) {
                    await this._ensureInitialized(config);
                }
                return config;
            });
        }
        return this._configPromise;
    }

    async _ensureInitialized(config) {
        try {
            const { initialize } = require('@blaxel/core');
            initialize({
                apiKey: config.apiKey,
                workspace: config.workspace,
                region: config.region,
            });
            this._initialized = true;
        } catch (e) {
            // Log but don't throw - will retry on next call
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
        const config = await this._getConfig();
        const name = opts.runtimeId || sandboxName(project);
        const image = opts.image || config.sandboxImage;
        const memory = opts.memory || config.sandboxMemory;

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
                    region: config.region,
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
