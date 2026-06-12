const fastify = require('fastify')({ logger: true });
const crypto = require('crypto');
const WebSocket = require('ws');

const { getRuntime } = require('./runtime/registry');
const { AgentSpawnError, RuntimeError } = require('./runtime/interfaces');
const { ensureProjectRuntime, formatRuntime } = require('./runtime/RuntimeService');
const deploymentService = require('./deployments/DeploymentService');
const repositoryEnvironment = require('./repositories/RepositoryEnvironmentService');
const { registerPreviewGateway } = require('./preview/gateway');
const { registerLlmProxy } = require('./llm/proxy');
const { issueSessionToken } = require('./llm/sessionToken');
const agentGatewayConfig = require('./admin/AgentGatewayConfig');
const { startPreviewLifecycle } = require('./preview/lifecycle');
const sessionManager = require('./session/SessionManager');

const { db } = require('./db/index');
const schema = require('./db/schema');
const { eq, and, sql } = require('drizzle-orm');
const auth = require('./auth/index');
const { registerAuthHooks } = require('./auth/hooks');
const policy = require('./auth/PolicyService');
const { registerAuthRoutes } = require('./routes/auth');
const { registerAdminRoutes } = require('./routes/admin');
const unigateway = require('./gateway/unigatewayManager');
const { registerGatewayAdminRoutes } = require('./gateway/adminProxy');
const { deleteProjectForUser } = require('./projects/deleteProject');

const runtime = getRuntime();

function formatAgentRow(a) {
    return {
        id: a.id,
        name: a.name,
        cmd: a.cmd,
        args: JSON.parse(a.args),
        env_required: JSON.parse(a.envRequired),
    };
}

async function getProjectForUser(userId, projectId) {
    const rows = await db.select().from(schema.projects)
        .where(eq(schema.projects.id, projectId));
    if (rows.length === 0 || rows[0].userId !== userId) return null;
    return rows[0];
}

fastify.register(require('@fastify/cors'), {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
fastify.register(require('@fastify/websocket'));

registerAuthHooks(fastify);
registerAuthRoutes(fastify);
registerAdminRoutes(fastify);
registerGatewayAdminRoutes(fastify);

// -- API Routes --

fastify.get('/api/v1/secrets', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.select().from(schema.secrets).where(eq(schema.secrets.userId, request.user.id));
    if (result.length === 0) return {};
    return auth.decryptSecrets(result[0].encryptedData);
});

fastify.post('/api/v1/secrets', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    try {
        const existing = await db.select().from(schema.secrets).where(eq(schema.secrets.userId, request.user.id));
        let currentSecrets = {};
        if (existing.length > 0) {
            currentSecrets = auth.decryptSecrets(existing[0].encryptedData);
        }

        const updates = Object.fromEntries(
            Object.entries(request.body || {}).filter(([, v]) => v != null && String(v).trim() !== '')
        );
        const mergedSecrets = { ...currentSecrets, ...updates };
        const encrypted = auth.encryptSecrets(mergedSecrets);

        if (existing.length > 0) {
            await db.update(schema.secrets).set({ encryptedData: encrypted }).where(eq(schema.secrets.userId, request.user.id));
        } else {
            await db.insert(schema.secrets).values({ userId: request.user.id, encryptedData: encrypted });
        }
        return { success: true, secrets: mergedSecrets };
    } catch (e) {
        request.log.error(e);
        return reply.code(500).send({ error: 'Failed to save secrets' });
    }
});

const DEFAULT_AGENT_ID = 'kimi-code';

fastify.get('/api/v1/agents', { preValidation: [fastify.authenticate] }, async (request) => {
    const agentGatewayConfig = require('./admin/AgentGatewayConfig');
    const platformSettings = require('./admin/PlatformSettings');
    const grantedIds = await policy.listGrantedAgentIds(request.user.id, request.user.role);
    const grantedSet = new Set(grantedIds);
    const allAgents = await db.select().from(schema.agents);
    const filtered = request.user.role === 'admin'
        ? allAgents
        : allAgents.filter((a) => grantedSet.has(a.id));
    filtered.sort((a, b) => {
        if (a.id === DEFAULT_AGENT_ID) return -1;
        if (b.id === DEFAULT_AGENT_ID) return 1;
        return a.name.localeCompare(b.name);
    });
    const gatewayConfigs = await agentGatewayConfig.getAll();
    return Promise.all(filtered.map(async (a) => {
        const cfg = gatewayConfigs[a.id];
        return {
            ...formatAgentRow(a),
            llm_auth_mode: await agentGatewayConfig.getAgentAuthMode(a.id),
            gateway_model: cfg?.model || null,
        };
    }));
});

fastify.post('/api/v1/agents', { preValidation: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { id, name, cmd, args, env_required } = request.body;
    try {
        await db.insert(schema.agents).values({
            id, name, cmd,
            args: JSON.stringify(args || []),
            envRequired: JSON.stringify(env_required || [])
        });
        return { success: true };
    } catch (e) {
        return reply.code(400).send({ error: 'Failed to insert agent or ID already exists' });
    }
});

fastify.put('/api/v1/agents/:id', { preValidation: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const { name, cmd, args, env_required } = request.body || {};
    const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, request.params.id));
    if (rows.length === 0) return reply.code(404).send({ error: 'Agent not found' });
    await db.update(schema.agents).set({
        ...(name !== undefined && { name }),
        ...(cmd !== undefined && { cmd }),
        ...(args !== undefined && { args: JSON.stringify(args) }),
        ...(env_required !== undefined && { envRequired: JSON.stringify(env_required) }),
    }).where(eq(schema.agents.id, request.params.id));
    return { success: true };
});

fastify.delete('/api/v1/agents/:id', { preValidation: [fastify.authenticate, fastify.requireAdmin] }, async (request, reply) => {
    const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, request.params.id));
    if (rows.length === 0) return reply.code(404).send({ error: 'Agent not found' });
    await db.delete(schema.userAgentGrants).where(eq(schema.userAgentGrants.agentId, request.params.id));
    await db.delete(schema.agents).where(eq(schema.agents.id, request.params.id));
    return { ok: true };
});

// Projects — list
fastify.get('/api/v1/projects', { preValidation: [fastify.authenticate] }, async (request) => {
    const rows = await db.select().from(schema.projects)
        .where(eq(schema.projects.userId, request.user.id));
    return rows
        .map((p) => ({
            id: p.id,
            name: p.name,
            server_path: p.serverPath,
            default_runtime_id: p.defaultRuntimeId,
            repo_provider: p.repoProvider || 'none',
            repo_url: p.repoUrl || null,
            repo_default_branch: p.repoDefaultBranch || 'main',
            workspace_mode: p.workspaceMode || 'local',
            last_sync_sha: p.lastSyncSha || null,
            last_snapshot_id: p.lastSnapshotId || null,
            dev_profile_id: p.devProfileId || null,
            created_at: p.createdAt,
        }))
        .sort((a, b) => b.created_at - a.created_at);
});

// Projects — create（通过 RuntimeProvider.ensureReady 创建 workspace）
fastify.post('/api/v1/projects', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const quotaCheck = await policy.checkQuota(request.user.id, 'projects', request.user.role);
    if (!quotaCheck.ok) return policy.quotaErrorReply(reply, quotaCheck);

    const name = String(request.body?.name || '').trim();
    if (!name) return reply.code(400).send({ error: 'Project name is required' });
    if (name.length > 120) return reply.code(400).send({ error: 'Project name is too long' });

    const projectId = `proj_${crypto.randomBytes(8).toString('hex')}`;
    const createdAt = Date.now();
    const stubProject = { id: projectId, userId: request.user.id, serverPath: '', defaultRuntimeId: null };

    let workspacePath;
    let defaultRuntimeId;
    try {
        await db.insert(schema.projects).values({
            id: projectId,
            userId: request.user.id,
            name,
            serverPath: '',
            createdAt,
        });
        const { runtime, workspacePath: ws } = await ensureProjectRuntime(
            { ...stubProject, id: projectId },
        );
        workspacePath = ws;
        defaultRuntimeId = runtime.id;
    } catch (err) {
        request.log.error(err);
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId)).catch(() => {});
        return reply.code(500).send({ error: 'Failed to create project directory' });
    }

    return {
        id: projectId,
        name,
        server_path: workspacePath,
        default_runtime_id: defaultRuntimeId,
        created_at: createdAt,
    };
});

// Repository environment — 外部 Git provider 绑定与工程环境元数据
fastify.delete('/api/v1/projects/:projectId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    try {
        await deleteProjectForUser(request.user.id, project);
        return { ok: true };
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to delete project' });
    }
});

fastify.get('/api/v1/projects/:projectId/repository', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return repositoryEnvironment.formatRepository(project);
});

fastify.put('/api/v1/projects/:projectId/repository', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return repositoryEnvironment.updateRepository(project, request.body || {});
});

fastify.get('/api/v1/projects/:projectId/dev-profile', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return { profile: await repositoryEnvironment.getDevProfile(project) };
});

fastify.put('/api/v1/projects/:projectId/dev-profile', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return repositoryEnvironment.upsertDevProfile(project, request.body || {});
});

fastify.get('/api/v1/projects/:projectId/repo-snapshots', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return repositoryEnvironment.listSnapshots(project.id);
});

fastify.post('/api/v1/projects/:projectId/repo-snapshots', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    const snapshot = await repositoryEnvironment.createSnapshot(project, request.body || {});
    return reply.code(201).send(snapshot);
});

fastify.get('/api/v1/projects/:projectId/checkpoints', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return repositoryEnvironment.listCheckpoints(project.id);
});

fastify.post('/api/v1/projects/:projectId/checkpoints', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const sessionId = request.body?.session_id || request.body?.sessionId;
    if (sessionId) {
        const rows = await db.select().from(schema.sessions)
            .where(and(
                eq(schema.sessions.id, sessionId),
                eq(schema.sessions.userId, request.user.id),
                eq(schema.sessions.projectId, project.id),
            ));
        if (rows.length === 0) return reply.code(404).send({ error: 'Session not found for this project' });
    }

    const checkpoint = await repositoryEnvironment.createCheckpoint(project, request.body || {}, request.user.id);
    return reply.code(201).send(checkpoint);
});

// Sessions — list
fastify.get('/api/v1/sessions', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, request.user.id));
    const projectRows = await db.select().from(schema.projects)
        .where(eq(schema.projects.userId, request.user.id));
    const projectNames = Object.fromEntries(projectRows.map((p) => [p.id, p.name]));
    return rows.map((row) => ({
        ...row,
        projectName: row.projectId ? projectNames[row.projectId] : null,
        alive: sessionManager.isAlive(row.id),
        memoryStatus: sessionManager.getSession(row.id)?.status ?? row.status,
    }));
});

fastify.delete('/api/v1/sessions/:sessionId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { sessionId } = request.params;
    const rows = await db.select().from(schema.sessions)
        .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, request.user.id)));
    if (rows.length === 0) return reply.code(404).send({ error: 'Session not found' });

    sessionManager.deleteSession(sessionId);
    await db.update(schema.sessions)
        .set({ status: 'exited' })
        .where(eq(schema.sessions.id, sessionId));
    return { ok: true };
});

// 启动 Agent Session（通过 RuntimeProvider + ExecAdapter）
fastify.post('/api/v1/session/start', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { agent_id, project_id } = request.body;
    if (!project_id) {
        return reply.code(400).send({ error: 'project_id is required. Select or create a project first.' });
    }

    const project = await getProjectForUser(request.user.id, project_id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const agentAccess = await policy.checkAgentAccess(request.user.id, agent_id, request.user.role);
    if (!agentAccess.ok) return policy.agentAccessErrorReply(reply, agentAccess);

    const sessionQuota = await policy.checkQuota(request.user.id, 'sessions', request.user.role);
    if (!sessionQuota.ok) return policy.quotaErrorReply(reply, sessionQuota);

    let workspacePath;
    let runtimeId;
    let recoverable;
    try {
        const ready = await ensureProjectRuntime(project);
        workspacePath = ready.workspacePath;
        runtimeId = ready.runtime.id;
        recoverable = ready.recoverable;
    } catch (err) {
        if (err instanceof RuntimeError) {
            return reply.code(err.statusCode).send({ error: err.message });
        }
        request.log.error(err);
        return reply.code(500).send({ error: 'Project workspace directory is missing and could not be recreated' });
    }

    const dbAgents = await db.select().from(schema.agents).where(eq(schema.agents.id, agent_id));
    if (dbAgents.length === 0) return reply.code(404).send({ error: 'Agent not found' });
    const agentMeta = {
        ...dbAgents[0],
        args: JSON.parse(dbAgents[0].args),
        env_required: JSON.parse(dbAgents[0].envRequired)
    };

    const sessionId = `sess_${crypto.randomBytes(8).toString('hex')}`;

    const authMode = await agentGatewayConfig.getAgentAuthMode(agentMeta.id);
    let sessionToken = null;
    if (authMode === 'gateway') {
        const gwCfg = await agentGatewayConfig.getForAgent(agentMeta.id);
        sessionToken = issueSessionToken({
            sessionId,
            userId: request.user.id,
            projectId: project_id,
            agentId: agentMeta.id,
            model: gwCfg?.model,
            role: request.user.role,
        });
    }

    const { resolveSpawnEnv } = require('./agents/agentEnv');
    const resolved = await resolveSpawnEnv({
        userId: request.user.id,
        agentId: agentMeta.id,
        envRequired: agentMeta.env_required,
        sessionToken,
        projectId: project_id,
    });
    if (!resolved.env) {
        return reply.code(400).send({ error: resolved.error });
    }

    await db.insert(schema.sessions).values({
        id: sessionId,
        userId: request.user.id,
        projectId: project_id,
        runtimeId,
        agentId: agent_id,
        cwd: workspacePath,
        streamRef: null,
        recoverable,
        status: 'running',
        createdAt: Date.now(),
    });

    let handle;
    try {
        handle = runtime.exec.spawn(
            agentMeta.cmd,
            agentMeta.args,
            resolved.env,
            { name: agentMeta.name, cwd: workspacePath }
        );
    } catch (err) {
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        if (err instanceof AgentSpawnError) {
            return reply.code(err.statusCode).send({ error: err.message });
        }
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to start agent session' });
    }

    sessionManager.createSession(sessionId, handle, agent_id);

    sessionManager.onExit(sessionId, () => {
        db.update(schema.sessions)
            .set({ status: 'exited' })
            .where(eq(schema.sessions.id, sessionId))
            .catch((err) => fastify.log.error(err, 'Failed to persist session exit status'));
    });

    const streamRef = handle.streamRef ?? null;
    if (streamRef) {
        await db.update(schema.sessions)
            .set({ streamRef })
            .where(eq(schema.sessions.id, sessionId));
    }

    return {
        session_id: sessionId,
        status: 'running',
        runtime_id: runtimeId,
        stream_ref: streamRef,
        recoverable,
    };
});

// WebSocket Terminal（协议不变，内部 bridge 改用 handle 接口）
fastify.register(async function terminalWsRoutes(app) {
    app.get('/ws/v1/terminal', { websocket: true }, (connection, req) => {
        const ws = connection.socket;

        const sendJson = (payload) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(payload));
            }
        };

        let sessionId = null;
        try {
            const url = new URL(req.url, 'http://localhost');
            sessionId = url.searchParams.get('sessionId');
        } catch (_) {
            sessionId = null;
        }

        const session = sessionId ? sessionManager.getSession(sessionId) : null;

        if (!session) {
            sendJson({
                type: 'error',
                data: 'Session not found. The backend may have restarted — use Restart to reconnect.',
            });
            ws.close();
            return;
        }

        if (session.history) {
            sendJson({ type: 'output', data: session.history });
        }

        if (!sessionManager.isAlive(sessionId)) {
            sendJson({
                type: 'error',
                data: 'This session has ended. Launch a new agent instead of reconnecting to an old one.',
            });
            ws.close();
            return;
        }

        const handle = session.handle;

        const cleanup = () => {
            offExit();
            dataListener.dispose();
            clearInterval(metricsInterval);
        };

        const dataListener = handle.onData((data) => {
            sendJson({ type: 'output', data });
        });

        const metricsInterval = setInterval(async () => {
            if (!sessionManager.isAlive(sessionId)) return;
            try {
                const stats = await handle.getMetrics();
                sendJson({ type: 'metrics', data: stats });
            } catch (_) { /* ignore metrics errors */ }
        }, 3000);

        const offExit = sessionManager.onExit(sessionId, (exitCode) => {
            sendJson({
                type: 'exit',
                data: exitCode,
                message: `\r\n\x1b[33m[Session ended with code ${exitCode ?? 'unknown'}]\x1b[0m\r\n`,
            });
            cleanup();
            try { ws.close(); } catch (_) { /* already closing */ }
        });

        ws.on('message', (message) => {
            if (!sessionManager.isAlive(sessionId)) return;
            try {
                const raw = typeof message === 'string' ? message : message.toString();
                const msg = JSON.parse(raw);
                if (msg.type === 'input') {
                    handle.write(msg.data);
                } else if (msg.type === 'resize') {
                    try {
                        handle.resize(msg.cols, msg.rows);
                    } catch (e) {
                        const errorMsg = e instanceof Error ? e.message : String(e);
                        if (!/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(errorMsg)) {
                            console.error('PTY Resize Error:', errorMsg);
                        }
                    }
                }
            } catch (err) {
                console.error('WS Message Parse Error:', err);
            }
        });

        ws.on('close', cleanup);
    });
});

// Runtimes — 按 project 列出（一等实体）
fastify.get('/api/v1/runtimes', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const projectId = request.query.project_id;
    if (!projectId) return reply.code(400).send({ error: 'project_id is required' });

    const project = await getProjectForUser(request.user.id, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const rows = await db.select().from(schema.runtimes)
        .where(eq(schema.runtimes.projectId, projectId));
    return rows.map(formatRuntime);
});

// Deployments — CRUD + preview start/stop（Architecture.md 步骤 2）
fastify.get('/api/v1/deployments', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const projectId = request.query.project_id;
    if (!projectId) return reply.code(400).send({ error: 'project_id is required' });

    const project = await getProjectForUser(request.user.id, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    return deploymentService.listForProject(request.user.id, projectId);
});

fastify.get('/api/v1/deployments/:deploymentId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const row = await deploymentService.getForUser(request.user.id, request.params.deploymentId);
    if (!row) return reply.code(404).send({ error: 'Deployment not found' });
    return deploymentService.formatDeployment(row);
});

fastify.post('/api/v1/projects/:projectId/preview', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const previewQuota = await policy.checkQuota(request.user.id, 'previews', request.user.role);
    if (!previewQuota.ok) return policy.quotaErrorReply(reply, previewQuota);

    try {
        const dep = await deploymentService.deployAndStartPreview(request.user.id, project);
        return reply.code(201).send(dep);
    } catch (err) {
        const code = err instanceof RuntimeError ? err.statusCode : 503;
        return reply.code(code).send({
            error: err instanceof Error ? err.message : 'Preview deploy failed',
        });
    }
});

fastify.post('/api/v1/deployments', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const projectId = request.body?.project_id;
    if (!projectId) return reply.code(400).send({ error: 'project_id is required' });

    const project = await getProjectForUser(request.user.id, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const previewQuota = await policy.checkQuota(request.user.id, 'previews', request.user.role);
    if (!previewQuota.ok) return policy.quotaErrorReply(reply, previewQuota);

    const dep = await deploymentService.createPreview(request.user.id, project);
    return reply.code(201).send(dep);
});

fastify.post('/api/v1/deployments/:deploymentId/start', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const row = await deploymentService.getForUser(request.user.id, request.params.deploymentId);
    if (!row) return reply.code(404).send({ error: 'Deployment not found' });

    const project = await getProjectForUser(request.user.id, row.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    try {
        return await deploymentService.startPreview(request.user.id, project, row);
    } catch (err) {
        const rowAfter = await deploymentService.getForUser(request.user.id, row.id);
        const code = err instanceof RuntimeError ? err.statusCode : 503;
        return reply.code(code).send({
            error: err instanceof Error ? err.message : 'Preview start failed',
            deployment: deploymentService.formatDeployment(rowAfter),
        });
    }
});

fastify.post('/api/v1/deployments/:deploymentId/stop', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const row = await deploymentService.getForUser(request.user.id, request.params.deploymentId);
    if (!row) return reply.code(404).send({ error: 'Deployment not found' });

    return deploymentService.stopPreview(request.user.id, row);
});

fastify.delete('/api/v1/deployments/:deploymentId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const row = await deploymentService.getForUser(request.user.id, request.params.deploymentId);
    if (!row) return reply.code(404).send({ error: 'Deployment not found' });

    await deploymentService.remove(request.user.id, row.id);
    return { ok: true };
});

// Workspace API — 经 runtime 解析 workspace 根路径后委托 FsAdapter
fastify.get('/api/v1/workspace/files', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const projectId = request.query.project_id;
    if (!projectId) return reply.code(400).send({ error: 'project_id is required' });

    const project = await getProjectForUser(request.user.id, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    try {
        const { workspacePath } = await ensureProjectRuntime(project);
        return runtime.fs.fsList(workspacePath);
    } catch (err) {
        const code = err instanceof RuntimeError ? err.statusCode : 500;
        return reply.code(code).send({ error: err.message });
    }
});

fastify.get('/api/v1/workspace/file', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const projectId = request.query.project_id;
    const filePath = request.query.path;
    if (!projectId) return reply.code(400).send({ error: 'project_id is required' });
    if (!filePath) return reply.code(400).send({ error: 'Missing path' });

    const project = await getProjectForUser(request.user.id, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    try {
        const { workspacePath } = await ensureProjectRuntime(project);
        const content = await runtime.fs.fsRead(workspacePath, filePath);
        return { content };
    } catch (err) {
        const code = err instanceof RuntimeError ? err.statusCode : 500;
        return reply.code(code).send({ error: err.message });
    }
});

async function startServer() {
    unigateway.installShutdownHooks(fastify.log);
    const gatewaySettings = require('./admin/GatewaySettings');
    const gatewayConfig = await gatewaySettings.getConfig();
    const gatewayStatus = gatewayConfig.auto_start
        ? await unigateway.start(fastify.log)
        : await unigateway.applyRuntimeConfig().then(() => unigateway.getStatus());
    try {
        const platformSecrets = require('./admin/PlatformSecrets');
        await unigateway.syncPlatformRouterSecrets(platformSecrets);
        fastify.log.info(`[unigateway] agent router -> ${gatewayStatus.baseUrl}`);
    } catch (err) {
        fastify.log.warn(err, '[unigateway] failed to sync platform router secrets');
    }

    await registerPreviewGateway(fastify);
    await registerLlmProxy(fastify);
    startPreviewLifecycle();

    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
}

startServer().catch((err) => {
    fastify.log.error(err);
    process.exit(1);
});
