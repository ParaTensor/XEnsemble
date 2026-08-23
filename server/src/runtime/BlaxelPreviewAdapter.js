const { PreviewAdapter, RuntimeError } = require('./interfaces');
const { SandboxInstance } = require('@blaxel/core');

const PREVIEW_SCRIPT_PRIORITY = ['dev', 'start', 'preview'];
const PREVIEW_READY_TIMEOUT_MS = Number(process.env.PREVIEW_READY_TIMEOUT_MS || 60_000);

async function getBlaxelApiKey() {
    try {
        const PlatformSettings = require('../admin/PlatformSettings');
        const fromDb = await PlatformSettings.get('BLAXEL_API_KEY');
        if (fromDb) return fromDb;
    } catch (_) { /* fall through */ }
    return process.env.BL_API_KEY || '';
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function processId(result) {
    return result?.pid || result?.name || result?.id || result?.processId || null;
}

/**
 * Blaxel preview adapter.
 *
 * A preview has two parts:
 *  1. start the user's dev server inside the Blaxel sandbox;
 *  2. expose its port through a Blaxel preview and proxy that URL through the
 *     XEnsemble deployment-scoped preview gateway.
 */
class BlaxelPreviewAdapter extends PreviewAdapter {
    async startPreview(project, contract = {}) {
        const deploymentId = contract.deploymentId;
        if (!deploymentId) throw new RuntimeError('deploymentId is required', 400);
        const runtimeRef = await this._resolveRuntimeRef(project);
        if (!runtimeRef) throw new RuntimeError('No runtime provisioned for this project', 404);
        const workspacePath = project.workspacePath;
        if (!workspacePath) throw new RuntimeError('Project workspace is not ready', 503);

        const previewRegistry = require('./localPreviewRegistry');
        const existing = previewRegistry.get(deploymentId);
        if (existing) {
            await this._stopEntry(existing);
            previewRegistry.remove(deploymentId);
        }

        try {
            const sandbox = await SandboxInstance.get(runtimeRef);
            if (!sandbox) throw new RuntimeError('Sandbox not found', 404);

            const spec = await this._resolvePreviewSpec(sandbox, workspacePath);
            const port = spec.port;
            const env = {
                PORT: String(port),
                HOST: '0.0.0.0',
                BROWSER: 'none',
            };
            const command = `sh -lc ${shellQuote(spec.shell)}`;
            const process = await sandbox.process.exec({
                command,
                env,
                workingDir: workspacePath,
                timeout: 0,
            });
            const pid = processId(process);
            if (!pid) throw new Error('preview process returned no process identifier');

            await this._waitForPort(sandbox, port, pid);

            const previewName = `xe-${port}`;
            const preview = await sandbox.previews.createIfNotExists({
                metadata: { name: previewName },
                spec: { port, protocol: 'http' },
            });
            const remoteUrl = preview?.spec?.url || preview?.metadata?.annotations?.url || null;
            if (!remoteUrl) throw new Error('Blaxel preview created but no URL returned');

            const apiKey = await getBlaxelApiKey();
            previewRegistry.set(deploymentId, {
                port,
                pid,
                processId: pid,
                sandboxName: runtimeRef,
                previewName,
                workspacePath,
                remote: {
                    url: remoteUrl,
                    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
                },
                startedAt: Date.now(),
            }, { persist: false });

            const { resolveControlPlanePublicUrlSync } = require('../llm/publicUrl');
            const publicUrl = `${resolveControlPlanePublicUrlSync()}/preview/${deploymentId}/`;
            return {
                publicUrl,
                internalRef: remoteUrl,
                url: remoteUrl,
                port,
                sandboxName: runtimeRef,
            };
        } catch (e) {
            if (e instanceof RuntimeError) throw e;
            throw new RuntimeError(`Failed to start preview: ${e.message}`, 502);
        }
    }

    async _resolvePreviewSpec(sandbox, workspacePath) {
        let config = null;
        try {
            config = JSON.parse(await sandbox.fs.read(`${workspacePath}/.agents/preview.json`));
        } catch (_) { /* optional */ }

        if (config?.command) {
            const args = Array.isArray(config.args) ? config.args : [];
            // `command` is intentionally a shell snippet (the same contract as
            // LocalPreviewAdapter); quote only the optional argument tokens so
            // values such as `npm run dev` remain valid commands.
            const argText = args.map(shellQuote).join(' ');
            return {
                shell: `${config.command}${argText ? ` ${argText}` : ''}`,
                port: Number(config.port) || 5173,
            };
        }

        let pkg = null;
        try {
            pkg = JSON.parse(await sandbox.fs.read(`${workspacePath}/package.json`));
        } catch (_) { /* handled below */ }
        const scripts = pkg?.scripts || {};
        const scriptName = PREVIEW_SCRIPT_PRIORITY.find((name) => scripts[name]);
        if (!scriptName) {
            throw new RuntimeError(
                'package.json has no dev/start/preview script; add .agents/preview.json',
                400,
            );
        }
        return {
            shell: `npm run ${shellQuote(scriptName)}`,
            port: Number(process.env.PREVIEW_DEFAULT_PORT) || 5173,
        };
    }

    async _waitForPort(sandbox, port, pid) {
        const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
        for (;;) {
            try {
                const response = await sandbox.fetch(port, '/', {
                    signal: AbortSignal.timeout(3000),
                });
                // Any HTTP response means the listener is reachable; application
                // status (including 404) is not a readiness failure.
                if (response) return;
            } catch (_) { /* not listening yet */ }

            try {
                const info = await sandbox.process.get(pid);
                if (info && ['completed', 'failed', 'killed', 'stopped'].includes(info.status)) {
                    const detail = String(info.logs || info.stderr || '').slice(-500);
                    throw new Error(`preview process exited ${info.exitCode ?? 'unknown'}${detail ? `: ${detail}` : ''}`);
                }
            } catch (e) {
                if (e.message?.startsWith('preview process exited')) throw e;
            }

            if (Date.now() >= deadline) {
                throw new Error(`preview port ${port} did not become ready within ${PREVIEW_READY_TIMEOUT_MS}ms`);
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    async _resolveRuntimeRef(project) {
        return this._resolveRuntimeRefById(project?.defaultRuntimeId);
    }

    async _resolveRuntimeRefById(runtimeId) {
        try {
            const { db } = require('../db/index');
            const schema = require('../db/schema');
            const { eq } = require('drizzle-orm');
            if (!runtimeId) return null;
            const rows = await db.select().from(schema.runtimes)
                .where(eq(schema.runtimes.id, runtimeId));
            return rows[0]?.runtimeRef || null;
        } catch (_) {
            return null;
        }
    }

    /** Recover a remote preview after the control-plane process restarts. */
    async recoverPreview(deployment) {
        const runtimeRef = await this._resolveRuntimeRefById(deployment?.runtimeId);
        if (!runtimeRef || !deployment?.internalRef) return null;
        try {
            const sandbox = await SandboxInstance.get(runtimeRef);
            const previews = await sandbox.previews.list();
            const match = previews.find((p) => p?.spec?.url === deployment.internalRef);
            const port = Number(match?.spec?.port);
            if (!match || !Number.isInteger(port) || port <= 0) return null;
            try {
                await sandbox.fetch(port, '/', { signal: AbortSignal.timeout(3000) });
            } catch (_) {
                return null;
            }
            const apiKey = await getBlaxelApiKey();
            return {
                port,
                pid: null,
                sandboxName: runtimeRef,
                previewName: match.name,
                workspacePath: null,
                startedAt: Date.now(),
                recovered: true,
                remote: {
                    url: deployment.internalRef,
                    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
                },
            };
        } catch (_) {
            return null;
        }
    }

    async _stopEntry(entry) {
        if (!entry) return;
        try {
            const sandbox = await SandboxInstance.get(entry.sandboxName);
            if (entry.pid) await sandbox.process.kill(entry.pid).catch(() => {});
            if (entry.previewName) await sandbox.previews.delete(entry.previewName).catch(() => {});
        } catch (_) { /* best-effort */ }
    }

    async stopPreview(deployment) {
        const previewRegistry = require('./localPreviewRegistry');
        const entry = previewRegistry.get(deployment?.id);
        if (entry) {
            await this._stopEntry(entry);
            previewRegistry.remove(deployment.id);
            return;
        }

        // After a control-plane restart the in-memory entry is gone. Recover the
        // sandbox from the runtime row and remove the preview matching the stored
        // remote URL, if possible.
        try {
            const { db } = require('../db/index');
            const schema = require('../db/schema');
            const { eq } = require('drizzle-orm');
            const rows = deployment?.runtimeId
                ? await db.select().from(schema.runtimes).where(eq(schema.runtimes.id, deployment.runtimeId))
                : [];
            const runtimeRef = rows[0]?.runtimeRef;
            if (!runtimeRef) return;
            const sandbox = await SandboxInstance.get(runtimeRef);
            const previews = await sandbox.previews.list();
            const match = previews.find((p) => p?.spec?.url === deployment.internalRef);
            if (match?.name) await sandbox.previews.delete(match.name).catch(() => {});
        } catch (_) { /* best-effort */ }
    }
}

module.exports = BlaxelPreviewAdapter;
