const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const executor = require('./runtime/Executor');
const { AgentSpawnError } = require('./runtime/Executor');
const sessionManager = require('./session/SessionManager');
const monitor = require('./runtime/Monitor');

// 导入 DB 和 Auth 模块
const { db } = require('./db/index');
const schema = require('./db/schema');
const { eq, and, sql } = require('drizzle-orm');
const auth = require('./auth/index');
const workspace = require('./workspace');

async function getProjectForUser(userId, projectId) {
    const rows = await db.select().from(schema.projects)
        .where(eq(schema.projects.id, projectId));
    if (rows.length === 0 || rows[0].userId !== userId) return null;
    return rows[0];
}

fastify.register(require('@fastify/cors'), {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
});
fastify.register(require('@fastify/websocket'));

// Auth Hook
fastify.decorate('authenticate', async function (request, reply) {
    try {
        const token = request.headers.authorization?.replace('Bearer ', '');
        if (!token) throw new Error('Missing token');
        const user = auth.verifyToken(token);
        if (!user) throw new Error('Invalid token');
        request.user = user;
    } catch (err) {
        reply.code(401).send({ error: 'Unauthorized' });
    }
});

// -- API Routes --

// 注册
fastify.post('/api/v1/auth/register', async (request, reply) => {
    const { username, password } = request.body;
    try {
        const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
        
        // If this is the first user, make them admin
        const usersCount = await db.select({ count: sql`count(*)` }).from(schema.users);
        const role = usersCount[0].count === 0 ? 'admin' : 'user';

        await db.insert(schema.users).values({
            id: userId,
            username,
            passwordHash: auth.hashPassword(password),
            role: role,
            createdAt: Date.now()
        });
        const token = auth.generateToken({ id: userId, username, role });
        return { token, user: { id: userId, username, role } };
    } catch (e) {
        return reply.code(400).send({ error: 'Username already exists' });
    }
});

// 登录
fastify.post('/api/v1/auth/login', async (request, reply) => {
    const { username, password } = request.body;
    const users = await db.select().from(schema.users).where(eq(schema.users.username, username));
    if (users.length === 0 || !auth.verifyPassword(password, users[0].passwordHash)) {
        return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const token = auth.generateToken(users[0]);
    return { token, user: { id: users[0].id, username: users[0].username, role: users[0].role } };
});

// 获取凭证设置
fastify.get('/api/v1/secrets', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const result = await db.select().from(schema.secrets).where(eq(schema.secrets.userId, request.user.id));
    if (result.length === 0) return {};
    return auth.decryptSecrets(result[0].encryptedData);
});

// 保存凭证设置 (Merge with existing)
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

fastify.get('/api/v1/agents', async () => {
    const allAgents = await db.select().from(schema.agents);
    allAgents.sort((a, b) => {
        if (a.id === DEFAULT_AGENT_ID) return -1;
        if (b.id === DEFAULT_AGENT_ID) return 1;
        return a.name.localeCompare(b.name);
    });
    return allAgents.map(a => ({
        id: a.id,
        name: a.name,
        cmd: a.cmd,
        args: JSON.parse(a.args),
        env_required: JSON.parse(a.envRequired)
    }));
});

// Admin: 添加新 Agent
fastify.post('/api/v1/agents', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    // In a real app, verify request.user.role === 'admin'
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

// Projects — list (Pick)
fastify.get('/api/v1/projects', { preValidation: [fastify.authenticate] }, async (request) => {
    const rows = await db.select().from(schema.projects)
        .where(eq(schema.projects.userId, request.user.id));
    return rows
        .map((p) => ({
            id: p.id,
            name: p.name,
            server_path: p.serverPath,
            created_at: p.createdAt,
        }))
        .sort((a, b) => b.created_at - a.created_at);
});

// Projects — create empty directory (New)
fastify.post('/api/v1/projects', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const name = String(request.body?.name || '').trim();
    if (!name) return reply.code(400).send({ error: 'Project name is required' });
    if (name.length > 120) return reply.code(400).send({ error: 'Project name is too long' });

    const projectId = `proj_${crypto.randomBytes(8).toString('hex')}`;
    let serverPath;
    try {
        serverPath = workspace.createProjectDirectory(request.user.id, projectId);
    } catch (err) {
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to create project directory' });
    }

    const createdAt = Date.now();
    await db.insert(schema.projects).values({
        id: projectId,
        userId: request.user.id,
        name,
        serverPath,
        createdAt,
    });

    return {
        id: projectId,
        name,
        server_path: serverPath,
        created_at: createdAt,
    };
});

// 获取用户会话列表（含内存 PTY 是否仍存活）
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
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    return { ok: true };
});

// 启动 Agent 实例
fastify.post('/api/v1/session/start', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { agent_id, project_id } = request.body;
    if (!project_id) {
        return reply.code(400).send({ error: 'project_id is required. Select or create a project first.' });
    }

    const project = await getProjectForUser(request.user.id, project_id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    if (!fs.existsSync(project.serverPath)) {
        try {
            fs.mkdirSync(project.serverPath, { recursive: true });
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Project workspace directory is missing and could not be recreated' });
        }
    }

    const dbAgents = await db.select().from(schema.agents).where(eq(schema.agents.id, agent_id));
    if (dbAgents.length === 0) return reply.code(404).send({ error: 'Agent not found' });
    const agentMeta = {
        ...dbAgents[0],
        args: JSON.parse(dbAgents[0].args),
        env_required: JSON.parse(dbAgents[0].envRequired)
    };

    // 从数据库中自动拉取环境变量凭证
    const dbSecrets = await db.select().from(schema.secrets).where(eq(schema.secrets.userId, request.user.id));
    const userSecrets = dbSecrets.length > 0 ? auth.decryptSecrets(dbSecrets[0].encryptedData) : {};

    for (const reqEnv of agentMeta.env_required) {
        if (!userSecrets[reqEnv]) {
            return reply.code(400).send({ error: `Missing required env in your Secrets Vault: ${reqEnv}` });
        }
    }

    const sessionId = `sess_${crypto.randomBytes(8).toString('hex')}`;
    let ptyProcess;
    try {
        ptyProcess = executor.spawn(
            agentMeta.cmd,
            agentMeta.args,
            userSecrets,
            request.user.id,
            { name: agentMeta.name, cwd: project.serverPath }
        );
    } catch (err) {
        if (err instanceof AgentSpawnError) {
            return reply.code(err.statusCode).send({ error: err.message });
        }
        request.log.error(err);
        return reply.code(500).send({ error: 'Failed to start agent session' });
    }

    sessionManager.createSession(sessionId, ptyProcess, agent_id);

    sessionManager.onExit(sessionId, () => {
        db.update(schema.sessions)
            .set({ status: 'exited' })
            .where(eq(schema.sessions.id, sessionId))
            .catch((err) => fastify.log.error(err, 'Failed to persist session exit status'));
    });

    // Kimi Code 启动时会阻塞在版本更新选择页，发送 Esc 进入主界面
    if (agent_id === 'kimi-code') {
        setTimeout(() => {
            try { ptyProcess.write('\x1b'); } catch (_) { /* session may have ended */ }
        }, 1200);
    }

    // 写入数据库做持久化记录
    await db.insert(schema.sessions).values({
        id: sessionId,
        userId: request.user.id,
        projectId: project_id,
        agentId: agent_id,
        cwd: project.serverPath,
        createdAt: Date.now()
    });

    return { session_id: sessionId, status: 'running' };
});

// WebSocket Terminal.
// IMPORTANT: register the ws route inside a plugin loaded AFTER @fastify/websocket so the
// plugin's onRoute hook is active. Defining { websocket: true } routes at the top level before
// the plugin finishes loading silently degrades them to plain HTTP GET (the connection arg
// becomes a Fastify Request, breaking the upgrade) — that was the root cause of the hangs/500s.
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
                data: 'Session not found. The backend may have restarted — launch a new agent.',
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

        const ptyProcess = session.ptyProcess;

        const cleanup = () => {
            offExit();
            ptyDataListener.dispose();
            clearInterval(metricsInterval);
        };

        const ptyDataListener = ptyProcess.onData((data) => {
            sendJson({ type: 'output', data });
        });

        const metricsInterval = setInterval(async () => {
            if (!sessionManager.isAlive(sessionId) || !ptyProcess?.pid) return;
            const stats = await monitor.getProcessStats(ptyProcess.pid);
            sendJson({ type: 'metrics', data: stats });
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
                    ptyProcess.write(msg.data);
                } else if (msg.type === 'resize') {
                    try {
                        ptyProcess.resize(msg.cols, msg.rows);
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

// Workspace API - List Files
fastify.get('/api/v1/workspace/files', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const projectId = request.query.project_id;
    if (!projectId) return reply.code(400).send({ error: 'project_id is required' });

    const project = await getProjectForUser(request.user.id, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const workspaceDir = project.serverPath;
    if (!fs.existsSync(workspaceDir)) return [];

    const rootResolved = path.resolve(workspaceDir);
    const getAllFiles = function(dirPath, arrayOfFiles) {
        let files;
        try { files = fs.readdirSync(dirPath); } catch (e) { return arrayOfFiles; }
        arrayOfFiles = arrayOfFiles || [];
        files.forEach(function(file) {
            const fullPath = path.join(dirPath, file);
            if (fs.statSync(fullPath).isDirectory()) {
                const rel = path.relative(rootResolved, fullPath);
                arrayOfFiles.push({ name: file, path: rel.startsWith('..') ? file : `/${rel}`.replace(/\\/g, '/'), type: 'directory' });
                arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
            } else {
                const rel = path.relative(rootResolved, fullPath);
                arrayOfFiles.push({ name: file, path: rel.startsWith('..') ? file : `/${rel}`.replace(/\\/g, '/'), type: 'file' });
            }
        });
        return arrayOfFiles;
    };
    return getAllFiles(workspaceDir, []);
});

// Workspace API - Read File
fastify.get('/api/v1/workspace/file', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const projectId = request.query.project_id;
    const filePath = request.query.path;
    if (!projectId) return reply.code(400).send({ error: 'project_id is required' });
    if (!filePath) return reply.code(400).send({ error: 'Missing path' });

    const project = await getProjectForUser(request.user.id, projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const absolutePath = workspace.resolveSafePath(project.serverPath, filePath);
    if (!absolutePath) return reply.code(403).send({ error: 'Access denied' });

    if (!fs.existsSync(absolutePath)) return reply.code(404).send({ error: 'File not found' });
    if (fs.statSync(absolutePath).isDirectory()) return reply.code(400).send({ error: 'Path is a directory' });

    const content = fs.readFileSync(absolutePath, 'utf8');
    return { content };
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
    if (err) { fastify.log.error(err); process.exit(1); }
});
