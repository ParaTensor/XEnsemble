const { RuntimeProvider, RuntimeError } = require('./interfaces');
const BoxLiteClient = require('./BoxLiteClient');
const { resolveBoxImage } = require('./agentBoxImages');
const { resolveBoxliteSessionNetwork } = require('./boxliteNetwork');
const BoxLiteExecAdapter = require('./BoxLiteExecAdapter');
const workspace = require('../workspace');
const { BoxLiteStreamHandle } = BoxLiteExecAdapter;

function buildWorkspaceMountKey(hostPath, guestPath) {
    return `${hostPath}=>${guestPath}`;
}

function resolveAgentProbeCommand(agentId) {
    if (!agentId) return null;
    const { DEFAULT_AGENTS } = require('../agents/defaultAgents');
    const agent = DEFAULT_AGENTS.find((entry) => entry.id === agentId);
    return agent?.cmd || null;
}

async function probeAgentCommand(client, sessionName, cmd, workspacePath) {
    if (!cmd) return true;
    const result = await client.execForResult(
        sessionName,
        'sh',
        ['-lc', `command -v ${JSON.stringify(cmd)} >/dev/null 2>&1`],
        {},
        workspacePath || '/',
    );
    return result.exitCode === 0;
}

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

    hostWorkspacePath(project) {
        return workspace.projectDir(project.userId, project.id);
    }

    buildWorkspaceVolume(project) {
        const guestPath = this.workspacePath();
        const hostPath = this.hostWorkspacePath(project);
        return {
            host_path: hostPath,
            guest_path: guestPath,
            read_only: false,
            mountKey: buildWorkspaceMountKey(hostPath, guestPath),
        };
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
        const image = await resolveBoxImage({
            agentId: opts.agentId,
            image: opts.image,
        });
        const warm = !!opts.warm;
        const workspaceVolume = this.buildWorkspaceVolume(project);
        const { host_path: hostWorkspacePath, guest_path: guestWorkspacePath, mountKey } = workspaceVolume;
        workspace.createProjectDirectory(project.userId, project.id);
        const storedImage = opts.storedImage || null;
        const storedMount = opts.storedMount || null;
        const imageMismatch = storedImage !== image;
        const recreateForImage = imageMismatch && (opts.forceRecreate || opts.agentId);
        const needRecreate = recreateForImage || storedMount !== mountKey;
        if (needRecreate) {
            try {
                await this.client.deleteSession(name);
                await new Promise((r) => setTimeout(r, 300));
            } catch (_) {
                // Ignore — openSession will detect the stale session below.
            }
        }
        const openOptions = {
            volumes: [{
                host_path: workspaceVolume.host_path,
                guest_path: workspaceVolume.guest_path,
                read_only: workspaceVolume.read_only,
            }],
            network: resolveBoxliteSessionNetwork(opts.network),
        };
        const openSession = async () => {
            const TRANSIENT_RE = /mkdir.*memory|memory dir|resource busy|temporarily|try again/i;
            const MAX_ATTEMPTS = 4;
            let lastErr = null;
            let reused = false;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
                try {
                    await this.client.openSession(name, image, warm, openOptions);
                    return { reused: false };
                } catch (e) {
                    if (/already|exists/i.test(String(e))) {
                        if (needRecreate) {
                            throw new RuntimeError(
                                `BoxLite ensureReady failed: session "${name}" still exists after delete - cannot recreate with image ${image}`,
                                502,
                            );
                        }
                        return { reused: true };
                    }
                    if (/mkdir.*memory/i.test(String(e))) {
                        const info = await this.client.getSessionStatus(name);
                        if (info && info.running) return { reused: true };
                    }
                    lastErr = e;
                    if (attempt < MAX_ATTEMPTS && TRANSIENT_RE.test(String(e))) {
                        await new Promise((r) => setTimeout(r, attempt * 500));
                        continue;
                    }
                    if (TRANSIENT_RE.test(String(e)) && !/resource busy/i.test(String(e))) {
                        try { await this.client.deleteSession(name); } catch (_) {}
                        await new Promise((r) => setTimeout(r, 1000));
                        try {
                            await this.client.openSession(name, image, warm, openOptions);
                            return { reused: false };
                        } catch (e2) {
                            if (/already|exists/i.test(String(e2))) {
                                throw new RuntimeError(
                                    `BoxLite ensureReady failed: session "${name}" still exists after delete+recreate retry`,
                                    502,
                                );
                            }
                            lastErr = e2;
                        }
                    }
                    throw new RuntimeError(`BoxLite ensureReady failed: ${lastErr.message}`, 502);
                }
            }
        };
        const { reused } = await openSession();

        if (!reused) {
            const cleanCaches = async () => {
                try {
                    await this.client.execForResult(name, 'sh', ['-c',
                        'for d in /root/.npm/_cacache /root/.cache /tmp; do rm -rf "$d"/* 2>/dev/null || true; done',
                    ]);
                } catch (_) {
                    // Best-effort: if the cleanup fails the agent still runs.
                }
            };
            await cleanCaches();
        }

        if (!reused) {
            const probeCmd = resolveAgentProbeCommand(opts.agentId);
            if (probeCmd && !(await probeAgentCommand(this.client, name, probeCmd, guestWorkspacePath))) {
                await this.client.deleteSession(name);
                await openSession();
                await this.client.execForResult(name, 'sh', ['-c',
                    'for d in /root/.npm/_cacache /root/.cache /tmp; do rm -rf "$d"/* 2>/dev/null || true; done',
                ]);
                if (!(await probeAgentCommand(this.client, name, probeCmd, guestWorkspacePath))) {
                    throw new RuntimeError(
                        `BoxLite ensureReady failed: agent command "${probeCmd}" is missing from sandbox image ${image}`,
                        502,
                    );
                }
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
        if (!reused) {
            await this.ensureWorkspacePath(name, guestWorkspacePath);
        }
        if (opts.agentId && !reused) {
            const { ensureAgentBootstrap } = require('../workspace/agentBootstrap');
            await ensureAgentBootstrap(project, hostWorkspacePath);
        }
        return { runtimeRef: name, workspacePath: guestWorkspacePath, image, mountKey };
    }

    async attach(runtimeRef) {
        return { runtimeRef, recoverable: false };
    }

    supportsHibernate() {
        return true;
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

    async hibernate(runtimeRef) {
        await this.client.stopSession(runtimeRef);
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
module.exports.buildWorkspaceMountKey = buildWorkspaceMountKey;
