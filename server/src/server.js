const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const executor = require('./runtime/Executor');
const sessionManager = require('./session/SessionManager');
const monitor = require('./runtime/Monitor');

// 导入 DB 和 Auth 模块
const { db } = require('./db/index');
const schema = require('./db/schema');
const { eq, sql } = require('drizzle-orm');
const auth = require('./auth/index');

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
    const existing = await db.select().from(schema.secrets).where(eq(schema.secrets.userId, request.user.id));
    let currentSecrets = {};
    if (existing.length > 0) {
        currentSecrets = auth.decryptSecrets(existing[0].encryptedData);
    }
    
    const mergedSecrets = { ...currentSecrets, ...request.body };
    const encrypted = auth.encryptSecrets(mergedSecrets);
    
    if (existing.length > 0) {
        await db.update(schema.secrets).set({ encryptedData: encrypted }).where(eq(schema.secrets.userId, request.user.id));
    } else {
        await db.insert(schema.secrets).values({ userId: request.user.id, encryptedData: encrypted });
    }
    return { success: true, secrets: mergedSecrets };
});

fastify.get('/api/v1/agents', async () => {
    const allAgents = await db.select().from(schema.agents);
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

// 获取用户活跃会话列表
fastify.get('/api/v1/sessions', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    return await db.select().from(schema.sessions).where(eq(schema.sessions.userId, request.user.id));
});

// 启动 Agent 实例
fastify.post('/api/v1/session/start', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const { agent_id } = request.body;
    
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
    const ptyProcess = executor.spawn(agentMeta.cmd, agentMeta.args, userSecrets, request.user.id);
    
    sessionManager.createSession(sessionId, ptyProcess, agent_id);
    
    // 写入数据库做持久化记录
    await db.insert(schema.sessions).values({
        id: sessionId,
        userId: request.user.id,
        agentId: agent_id,
        cwd: `/tmp/agent-workspaces/${request.user.id}`,
        createdAt: Date.now()
    });

    return { session_id: sessionId, status: 'running' };
});

// WebSocket Terminal
fastify.get('/ws/v1/terminal', { websocket: true }, (connection, req) => {
    const url = new URL(req.url, 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    const session = sessionManager.getSession(sessionId);

    if (!session) {
        connection.socket.send(JSON.stringify({ type: 'error', data: 'Invalid or Expired Session' }));
        connection.socket.close();
        return;
    }

    const ptyProcess = session.ptyProcess;

    // 发送历史回放 (Session Replay)
    if (session.history) {
        connection.socket.send(JSON.stringify({ type: 'output', data: session.history }));
    }

    const ptyDataListener = ptyProcess.onData((data) => {
        connection.socket.send(JSON.stringify({ type: 'output', data: data }));
    });

    // 开启系统资源监控轮询 (每3秒拉取一次底层 PTY 进程资源消耗)
    const metricsInterval = setInterval(async () => {
        if (!ptyProcess || !ptyProcess.pid) return;
        const stats = await monitor.getProcessStats(ptyProcess.pid);
        connection.socket.send(JSON.stringify({ type: 'metrics', data: stats }));
    }, 3000);

    connection.socket.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
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

    connection.socket.on('close', () => {
        ptyDataListener.dispose();
        clearInterval(metricsInterval);
    });
});

// Workspace API - List Files
fastify.get('/api/v1/workspace/files', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const workspaceDir = path.join('/tmp/agent-workspaces', request.user.id);
    if (!fs.existsSync(workspaceDir)) return [];
    
    // Recursive directory read for simple file tree
    const getAllFiles = function(dirPath, arrayOfFiles) {
        let files;
        try { files = fs.readdirSync(dirPath); } catch (e) { return arrayOfFiles; }
        arrayOfFiles = arrayOfFiles || [];
        files.forEach(function(file) {
            const fullPath = path.join(dirPath, file);
            if (fs.statSync(fullPath).isDirectory()) {
                arrayOfFiles.push({ name: file, path: fullPath.replace(workspaceDir, ''), type: 'directory' });
                arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
            } else {
                arrayOfFiles.push({ name: file, path: fullPath.replace(workspaceDir, ''), type: 'file' });
            }
        });
        return arrayOfFiles;
    };
    return getAllFiles(workspaceDir, []);
});

// Workspace API - Read File
fastify.get('/api/v1/workspace/file', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const filePath = request.query.path;
    if (!filePath) return reply.code(400).send({ error: 'Missing path' });
    
    // Security: prevent directory traversal
    const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolutePath = path.join('/tmp/agent-workspaces', request.user.id, safePath);
    
    if (!absolutePath.startsWith(path.join('/tmp/agent-workspaces', request.user.id))) {
        return reply.code(403).send({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(absolutePath)) return reply.code(404).send({ error: 'File not found' });
    
    const content = fs.readFileSync(absolutePath, 'utf8');
    return { content };
});

fastify.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
    if (err) { fastify.log.error(err); process.exit(1); }
});
