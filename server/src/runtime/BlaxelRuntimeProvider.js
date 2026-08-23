const { RuntimeProvider, RuntimeError } = require('./interfaces');
const { SandboxInstance } = require('@blaxel/core');
const workspace = require('../workspace');
const PlatformSettings = require('../admin/PlatformSettings');

const TOOLING_DIR = '/tmp/.xe';

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

// Blaxel requires: only lowercase alphanumeric and hyphens
function sanitizeName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function shellQuote(s) {
    return `'${String(s).replace(/'/g, `'\''`)}'`;
}

function sandboxName(project) {
    return `xe-${sanitizeName(project.userId)}-${sanitizeName(project.id)}`.slice(0, 64).replace(/^-|-$/g, '');
}

class BlaxelRuntimeProvider extends RuntimeProvider {
    constructor() {
        super();
        this._configPromise = null;
        this._initialized = false;
    }

    async ensureInitialized() {
        await this._getConfig();
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
        // runtimeId (e.g. "rt_ab12cd") may contain underscores; Blaxel names cannot.
        const name = opts.runtimeId ? sanitizeName(opts.runtimeId) : sandboxName(project);
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
            // @blaxel/core exposes the filesystem as sandbox.fs; mkdir creates the dir server-side.
            await sandbox.fs.mkdir(wp);
        } catch (mkdirErr) {
            // An existing directory is fine, but do not hide network/auth errors.
            try {
                await sandbox.fs.ls(wp);
            } catch (verifyErr) {
                throw new RuntimeError(`Blaxel workspace directory is unavailable: ${verifyErr.message || mkdirErr.message}`, 502);
            }
        }

        // The sandbox runs a shared base image without agent CLIs. Install the
        // requested agent's tooling once per sandbox (marker file makes this
        // idempotent while the sandbox lives).
        if (opts.agentId) {
            await this._ensureAgentTooling(sandbox, opts.agentId);
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

    /**
     * Install the agent CLI inside the sandbox (once per sandbox+agent).
     * Reuses the boxlite image-build install commands (npm/curl shell snippets)
     * since they are plain shell. The base image ships node/npm/wget/python3.
     */
    async _ensureAgentTooling(sandbox, agentId) {
        const { getAgentBoxInstallCommand } = require('./agentBoxImages');
        const installCmd = getAgentBoxInstallCommand(agentId);
        if (!installCmd) return;

        const marker = `/tmp/.xe/tooling-${agentId}.ok`;
        const script = [
            'set -e',
            `mkdir -p ${TOOLING_DIR}`,
            `[ -f ${marker} ] && exit 0`,
            installCmd,
            `touch ${marker}`,
        ].join('\n');

        // Long npm installs can outrun the edge's synchronous read timeout, so
        // kick the script off without waitForCompletion and poll the process.
        const proc = await sandbox.process.exec({ command: `sh -c ${shellQuote(script)}` });
        const pid = proc?.pid || proc?.name;
        if (!pid) throw new RuntimeError('Blaxel agent tooling install failed to start', 502);

        const deadline = Date.now() + 5 * 60 * 1000;
        for (;;) {
            await new Promise((r) => setTimeout(r, 2000));
            let info = null;
            try {
                info = await sandbox.process.get(pid);
            } catch (_) {
                info = null;
            }
            if (info && ['completed', 'failed', 'killed', 'stopped'].includes(info.status)) {
                if ((info.exitCode || 0) !== 0 || info.status !== 'completed') {
                    const tail = String(info.logs || info.stderr || '').split('\n').slice(-20).join('\n');
                    throw new RuntimeError(`Blaxel agent tooling install failed (exit ${info.exitCode}): ${tail}`, 502);
                }
                return;
            }
            if (Date.now() >= deadline) {
                throw new RuntimeError('Blaxel agent tooling install timed out', 502);
            }
        }
    }

    async attachSession(sessionId, streamRef) {
        // streamRef format: blaxel:<sandboxName>:<processId>[:<streamId>]
        if (typeof streamRef === 'string' && streamRef.startsWith('blaxel:')) {
            const BlaxelExecAdapter = require('./BlaxelExecAdapter');
            const adapter = new BlaxelExecAdapter();
            return adapter.attach(streamRef);
        }
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
