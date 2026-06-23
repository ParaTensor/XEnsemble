const TRUSTED_PROXIES = process.env.TRUSTED_PROXIES
    ? process.env.TRUSTED_PROXIES.split(',').map((s) => s.trim()).filter(Boolean)
    : false;
const fastify = require('fastify')({ logger: true, trustProxy: TRUSTED_PROXIES });
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
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
const userAdmin = require('./admin/UserAdminService');
const { startPreviewLifecycle } = require('./preview/lifecycle');
const sessionManager = require('./session/SessionManager');
const { reconcileRunningSessions } = require('./session/reconcileRunningSessions');

const { db } = require('./db/index');
const schema = require('./db/schema');
const { eq, and, sql } = require('drizzle-orm');
const auth = require('./auth/index');
const { assertActiveUser } = require('./auth/assertActiveUser');
const { registerAuthHooks } = require('./auth/hooks');
const policy = require('./auth/PolicyService');
const { registerAuthRoutes } = require('./routes/auth');
const { registerAdminRoutes } = require('./routes/admin');
const { registerUserRoutes } = require('./routes/user');
const { registerTerminalHttpRoutes } = require('./routes/terminalHttp');
const { registerGitHubRoutes } = require('./routes/github');
const { registerGitRoutes } = require('./routes/git');
const { registerGitHubAppRoutes } = require('./routes/githubApp');
const { LocalGitService } = require('./git/LocalGitService');
const { applyTerminalMessage, subscribeTerminal } = require('./session/terminalBridge');
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

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : ['http://127.0.0.1:5173', 'http://localhost:5173'];

fastify.register(require('@fastify/cors'), {
    origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) {
            cb(null, true);
            return;
        }
        cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
});
fastify.register(require('@fastify/websocket'));

registerAuthHooks(fastify);
registerAuthRoutes(fastify);
registerAdminRoutes(fastify);
registerUserRoutes(fastify);
registerTerminalHttpRoutes(fastify);
registerGatewayAdminRoutes(fastify);
registerGitHubRoutes(fastify);
registerGitRoutes(fastify);
registerGitHubAppRoutes(fastify);

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
    const installedAgents = require('./agents/installedAgents');
    const grantedIds = await policy.listGrantedAgentIds(request.user.id, request.user.role);
    const grantedSet = new Set(grantedIds);
    const allAgents = await installedAgents.listInstalledAgentRows();
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

    // Initialize built-in Git repo (Layer 1) for the new project
    try {
        const localGit = new LocalGitService();
        const fullProject = { id: projectId, userId: request.user.id };
        await localGit.initRepo(fullProject);
    } catch (err) {
        request.log.warn({ err, projectId }, 'Local git init failed (non-fatal)');
    }

    return {
        id: projectId,
        name,
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

    // Use LocalGitService for git-mode projects to execute real git commit
    if (project.workspaceMode === 'git') {
        try {
            const localGit = new LocalGitService();
            const meta = {
                sessionId: sessionId || null,
                trigger: request.body?.trigger || 'manual',
                summary: request.body?.summary || '',
                userId: request.user.id,
            };
            const checkpoint = await localGit.commitCheckpoint(project, meta);
            return reply.code(201).send(checkpoint);
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to create git checkpoint' });
        }
    }

    const checkpoint = await repositoryEnvironment.createCheckpoint(project, request.body || {}, request.user.id);
    return reply.code(201).send(checkpoint);
});

// Restore checkpoint
fastify.post('/api/v1/projects/:projectId/checkpoints/:checkpointId/restore', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const localGit = new LocalGitService();
    try {
        const result = await localGit.restoreCheckpoint(
            project,
            request.params.checkpointId,
            { cleanUntracked: request.body?.clean_untracked !== false },
        );
        return result;
    } catch (err) {
        request.log.error(err);
        const code = err.statusCode || 500;
        return reply.code(code).send({ error: err.message });
    }
});

// Repository log
fastify.get('/api/v1/projects/:projectId/repository/log', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const localGit = new LocalGitService();
    try {
        const count = request.query?.count ? Number(request.query.count) : 20;
        const log = await localGit.getLog(project, { count });
        return { commits: log };
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to get repository log' });
    }
});

// Checkpoint diff
fastify.get('/api/v1/projects/:projectId/checkpoints/:checkpointId/diff', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const rows = await db.select().from(schema.workspaceCheckpoints)
        .where(and(
            eq(schema.workspaceCheckpoints.id, request.params.checkpointId),
            eq(schema.workspaceCheckpoints.projectId, project.id),
        ));
    if (rows.length === 0) return reply.code(404).send({ error: 'Checkpoint not found' });

    const checkpoint = rows[0];
    if (!checkpoint.gitSha) return reply.code(409).send({ error: 'Checkpoint has no git_sha' });

    const localGit = new LocalGitService();
    try {
        const full = request.query?.full === 'true';
        const result = await localGit.getDiff(project, checkpoint.gitSha, { full });
        return result;
    } catch (err) {
        request.log.error(err);
        const code = err.statusCode || 500;
        return reply.code(code).send({ error: err.message });
    }
});

// ── Phase 4: Advanced Git APIs ──

// Git blame
fastify.get('/api/v1/projects/:projectId/repository/blame', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const { path: filePath, ref, start_line, end_line } = request.query || {};
    if (!filePath) return reply.code(400).send({ error: 'path query parameter is required' });

    const localGit = new LocalGitService();
    try {
        const entries = await localGit.blame(project, filePath, {
            ref,
            startLine: start_line ? Number(start_line) : undefined,
            endLine: end_line ? Number(end_line) : undefined,
        });
        return { path: filePath, ref: ref || 'HEAD', entries };
    } catch (err) {
        request.log.error(err);
        const code = err.statusCode || 500;
        return reply.code(code).send({ error: err.message });
    }
});

// Detailed commit log (with files changed, author info)
fastify.get('/api/v1/projects/:projectId/repository/log/detailed', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const localGit = new LocalGitService();
    try {
        const count = request.query?.count ? Number(request.query.count) : 20;
        const filePath = request.query?.path || undefined;
        const commits = await localGit.logDetailed(project, { count, path: filePath });
        return { commits };
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to get detailed log' });
    }
});

// Conflict check (dry-run merge to detect conflicts)
fastify.get('/api/v1/projects/:projectId/repository/conflict-check', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const targetBranch = request.query?.target || project.repoDefaultBranch || 'main';
    const localGit = new LocalGitService();
    try {
        const result = await localGit.conflictCheck(project, targetBranch);
        return { target_branch: targetBranch, ...result };
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to check conflicts' });
    }
});

// List conflict files (working tree)
fastify.get('/api/v1/projects/:projectId/repository/conflicts', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const localGit = new LocalGitService();
    try {
        const conflicts = await localGit.listConflicts(project);
        return { conflicts };
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to list conflicts' });
    }
});

// Resolve a conflict file
fastify.post('/api/v1/projects/:projectId/repository/conflicts/resolve', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const { path: filePath, strategy } = request.body || {};
    if (!filePath) return reply.code(400).send({ error: 'path is required' });
    if (!strategy || !['ours', 'theirs', 'manual'].includes(strategy)) {
        return reply.code(400).send({ error: 'strategy must be ours, theirs, or manual' });
    }

    const localGit = new LocalGitService();
    try {
        const result = await localGit.resolveConflict(project, filePath, strategy);
        return result;
    } catch (err) {
        request.log.error(err);
        const code = err.statusCode || 500;
        return reply.code(code).send({ error: err.message });
    }
});

// Show file content at a specific ref (for conflict side-by-side view)
fastify.get('/api/v1/projects/:projectId/repository/file', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const { path: filePath, ref } = request.query || {};
    if (!filePath) return reply.code(400).send({ error: 'path query parameter is required' });

    const localGit = new LocalGitService();
    try {
        const result = await localGit.showFile(project, filePath, ref || 'HEAD');
        return result;
    } catch (err) {
        request.log.error(err);
        const code = err.statusCode || 500;
        return reply.code(code).send({ error: err.message });
    }
});

// PR/MR Reviews (Code Review integration)
fastify.get('/api/v1/projects/:projectId/merge-requests/:mrId/reviews', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const providerName = project.repoProvider;
    if (!providerName || providerName === 'local_git' || providerName === 'none') {
        return { reviews: [] };
    }

    try {
        const { GitConnectionService } = require('./git/GitConnectionService');
        const { getProvider } = require('./git/providers/registry');
        const connService = new GitConnectionService();
        const token = await connService.getDecryptedToken(project.userId, providerName);
        if (!token) return { reviews: [] };

        const adapter = getProvider(providerName);
        const mrRows = await db.select().from(schema.mergeRequests)
            .where(eq(schema.mergeRequests.id, request.params.mrId));
        if (mrRows.length === 0) return reply.code(404).send({ error: 'Merge request not found' });
        const mr = mrRows[0];
        const prNumber = mr.remoteNumber;
        if (!prNumber) return { reviews: [] };

        const repoId = project.remoteFullName || project.githubFullName;
        const reviews = await adapter.listReviews(token, repoId, prNumber, {});
        return { reviews };
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch reviews' });
    }
});

// PR/MR Review comments (inline code comments)
fastify.get('/api/v1/projects/:projectId/merge-requests/:mrId/comments', {
    preValidation: [fastify.authenticate],
}, async (request, reply) => {
    const project = await getProjectForUser(request.user.id, request.params.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const providerName = project.repoProvider;
    if (!providerName || providerName === 'local_git' || providerName === 'none') {
        return { comments: [] };
    }

    try {
        const { GitConnectionService } = require('./git/GitConnectionService');
        const { getProvider } = require('./git/providers/registry');
        const connService = new GitConnectionService();
        const token = await connService.getDecryptedToken(project.userId, providerName);
        if (!token) return { comments: [] };

        const adapter = getProvider(providerName);
        const mrRows = await db.select().from(schema.mergeRequests)
            .where(eq(schema.mergeRequests.id, request.params.mrId));
        if (mrRows.length === 0) return reply.code(404).send({ error: 'Merge request not found' });
        const mr = mrRows[0];
        const prNumber = mr.remoteNumber;
        if (!prNumber) return { comments: [] };

        const repoId = project.remoteFullName || project.githubFullName;
        const page = request.query?.page ? Number(request.query.page) : 1;
        const comments = await adapter.listReviewComments(token, repoId, prNumber, { page });
        return { comments };
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to fetch review comments' });
    }
});

// Sessions — list
fastify.get('/api/v1/sessions', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, request.user.id));
    const projectRows = await db.select().from(schema.projects)
        .where(eq(schema.projects.userId, request.user.id));
    const projectNames = Object.fromEntries(projectRows.map((p) => [p.id, p.name]));
    return rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        agentId: row.agentId,
        status: row.status,
        memoryStatus: sessionManager.getSession(row.id)?.status ?? row.status,
        alive: sessionManager.isAlive(row.id),
        projectName: row.projectId ? projectNames[row.projectId] : null,
        title: row.title || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
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
    const { agent_id, project_id, terminal_theme_id } = request.body;
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
        terminalThemeId: terminal_theme_id,
        warn: (msg) => request.log.warn(msg),
    });
    if (!resolved.env) {
        return reply.code(400).send({ error: resolved.error });
    }

    if (project && project.repoProvider === 'github') {
        resolved.env.XENSEMBLE_GIT_BRANCH = project.currentBranch || '';
        resolved.env.XENSEMBLE_GIT_BASE_BRANCH = project.repoDefaultBranch || '';
        resolved.env.XENSEMBLE_REPO_URL = project.githubFullName || '';
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
            {
                name: agentMeta.name,
                cwd: workspacePath,
                uid: process.env.RUNTIME_UID,
                gid: process.env.RUNTIME_GID,
            }
        );
    } catch (err) {
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        if (err instanceof AgentSpawnError) {
            request.log.error(err);
            return reply.code(err.statusCode).send({ error: 'Failed to start agent session' });
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

        if (project && project.workspaceMode === 'git') {
            const { GitOperationService } = require('./github/GitOperationService');
            const gitOps = new GitOperationService({ getToken: () => null });
            gitOps.commitAll(project, `chore(xensemble): auto-checkpoint session ${sessionId}`)
                .catch(() => { /* best-effort: ignore if nothing to commit or workspace missing */ });
        }
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
        terminal_theme_id: resolved.terminal_theme_id,
        spawn_env_preview: resolved.spawn_env_preview,
    };
});

// WebSocket Terminal（协议不变；与 /api/v1/terminal/* HTTP 通道共享 terminalBridge）
fastify.register(async function terminalWsRoutes(app) {
    app.get('/ws/v1/terminal', { websocket: true }, async (connection, req) => {
        const ws = connection.socket;

        const sendJson = (payload) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(payload));
            }
        };

        try {
            let sessionId = null;
            let accessToken = null;
            try {
                const url = new URL(req.url, 'http://localhost');
                sessionId = url.searchParams.get('sessionId');
                accessToken = url.searchParams.get('access_token');
            } catch (_) {
                sessionId = null;
                accessToken = null;
            }

            if (!accessToken) {
                sendJson({ type: 'error', data: 'access_token is required' });
                ws.close();
                return;
            }

            const payload = auth.verifyAccessToken(accessToken);
            if (!payload?.id) {
                sendJson({ type: 'error', data: 'Invalid access token' });
                ws.close();
                return;
            }

            const active = await assertActiveUser(accessToken);
            if (active.error) {
                sendJson({ type: 'error', data: active.error });
                ws.close();
                return;
            }

            if (!sessionId) {
                sendJson({ type: 'error', data: 'sessionId is required' });
                ws.close();
                return;
            }

            const sessionRows = await db.select().from(schema.sessions)
                .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, payload.id)));
            if (sessionRows.length === 0 || sessionRows[0].status !== 'running') {
                sendJson({ type: 'error', data: 'Session not found or not active' });
                ws.close();
                return;
            }

            const sub = subscribeTerminal(sessionId, (payload) => {
                sendJson(payload);
                if (payload.type === 'exit' || payload.type === 'error') {
                    try { ws.close(); } catch (_) {}
                }
            });
            if (!sub.ok) {
                ws.close();
                return;
            }

            ws.on('message', (message) => {
                if (!sessionManager.isAlive(sessionId)) return;
                try {
                    const raw = typeof message === 'string' ? message : message.toString();
                    applyTerminalMessage(sub.handle, JSON.parse(raw));
                } catch (err) {
                    req.log.error(err);
                }
            });

            ws.on('close', sub.cleanup);
        } catch (err) {
            req.log.error(err);
            sendJson({ type: 'error', data: 'Internal server error' });
            ws.close();
        }
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

fastify.post('/api/v1/deployments/:deploymentId/preview-token', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const row = await deploymentService.getForUser(request.user.id, request.params.deploymentId);
    if (!row) return reply.code(404).send({ error: 'Deployment not found' });
    if (row.status !== 'running') return reply.code(503).send({ error: 'Preview is not running' });

    const previewToken = await deploymentService.issuePreviewToken(row.id);
    return { preview_token: previewToken };
});

// Workspace API — 经 runtime 解析 workspace 根路径后委托 FsAdapter
fastify.get('/api/v1/workspace/files', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const projectId = request.query.project_id;
    if (!projectId) return reply.code(400).send({ error: 'project_id is required' });

    const project = await getProjectForUser(request.user.id, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    try {
        const relativePath = request.query.path || '';
        const { workspacePath } = await ensureProjectRuntime(project);
        return runtime.fs.fsList(workspacePath, relativePath);
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to list workspace files' });
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
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to read file' });
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

    const staticRoot = path.join(__dirname, '../../client/dist');
    if (fs.existsSync(staticRoot)) {
        await fastify.register(require('@fastify/static'), {
            root: staticRoot,
            wildcard: false,
        });
        fastify.setNotFoundHandler((request, reply) => {
            const url = request.raw.url || '';
            if (url.startsWith('/api') || url.startsWith('/ws') || url.startsWith('/preview')) {
                return reply.code(404).send({ error: 'Not found' });
            }
            return reply.sendFile('index.html', staticRoot);
        });
        fastify.log.info(`[static] serving ${staticRoot}`);
    }

    const { resolvePort } = require('./config/defaultPort');
    const port = resolvePort();

    try {
        const reconcile = await reconcileRunningSessions(db, schema);
        if (reconcile.reconciled > 0) {
            fastify.log.info(
                `[sessions] reconciled ${reconcile.reconciled} stale running session(s)`,
            );
        }
    } catch (err) {
        fastify.log.warn(err, '[sessions] failed to reconcile stale sessions');
    }

    try {
        const sync = await userAdmin.syncInstalledAgentGrantsForAllUsers();
        if (sync.granted_count > 0) {
            fastify.log.info(
                `[agents] synced ${sync.granted_count} missing grant(s) for ${sync.agent_count} installed agent(s)`,
            );
        }
    } catch (err) {
        fastify.log.warn(err, '[agents] failed to sync installed agent grants');
    }

    await fastify.listen({ port, host: '0.0.0.0' });
}

startServer().catch((err) => {
    fastify.log.error(err);
    process.exit(1);
});
