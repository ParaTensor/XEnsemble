const fastify = require('fastify')({ logger: true });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const executor = require('./runtime/Executor');
const sessionManager = require('./session/SessionManager');

// 注册 CORS 插件，允许前端跨域访问
fastify.register(require('@fastify/cors'), {
    origin: '*',
    methods: ['GET', 'POST']
});

// 注册 WebSocket 插件
fastify.register(require('@fastify/websocket'));

// 加载支持的 Agents 列表
const agentsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));

// 1. 获取支持的 Agent 列表
fastify.get('/api/v1/agents', async () => {
    return agentsConfig.agents;
});

// 2. 启动特定 Agent 实例，初始化会话
fastify.post('/api/v1/session/start', async (request, reply) => {
    const { agent_id, configs } = request.body;
    const agentMeta = agentsConfig.agents.find(a => a.id === agent_id);
    
    if (!agentMeta) {
        return reply.code(404).send({ error: 'Agent not found' });
    }

    // 校验必填的环境变量配置
    for (const reqEnv of agentMeta.env_required) {
        if (!configs || !configs[reqEnv]) {
            return reply.code(400).send({ error: `Missing required env: ${reqEnv}` });
        }
    }

    const sessionId = `sess_${crypto.randomBytes(8).toString('hex')}`;
    
    // 调用抽象执行层拉起 PTY
    const ptyProcess = executor.spawn(agentMeta.cmd, agentMeta.args, configs);
    
    // 注册进会话管理器
    sessionManager.createSession(sessionId, ptyProcess, agent_id);

    return { session_id: sessionId, status: 'running' };
});

// 3. WebSocket 双向数据桥接路由
fastify.get('/ws/v1/terminal', { websocket: true }, (connection, req) => {
    // fastify req.url 可能是相对的，所以我们手动拼接一下
    const url = new URL(req.url, 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    const session = sessionManager.getSession(sessionId);

    if (!session) {
        connection.socket.send(JSON.stringify({ type: 'error', data: 'Invalid Session ID' }));
        connection.socket.close();
        return;
    }

    const ptyProcess = session.ptyProcess;

    // A. 监听 PTY 进程输出 (Stdout) -> 转发给前端 Web Terminal
    const ptyDataListener = ptyProcess.onData((data) => {
        connection.socket.send(JSON.stringify({ type: 'output', data: data }));
    });

    // B. 监听前端 Web 终端用户的输入或控制指令
    connection.socket.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.type === 'input') {
                ptyProcess.write(msg.data); // 写入 PTY 终端输入
            } else if (msg.type === 'resize') {
                try {
                    ptyProcess.resize(msg.cols, msg.rows); // 动态调整终端视口大小
                } catch (e) {
                    const errorMsg = e instanceof Error ? e.message : String(e);
                    // emdash source: suppress known node-pty errors during resize
                    if (!/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(errorMsg)) {
                        console.error('PTY Resize Error:', errorMsg);
                    }
                }
            }
        } catch (err) {
            console.error('WS Message Parse Error:', err);
        }
    });

    // C. 断开连接处理
    connection.socket.on('close', () => {
        // MVP 阶段：断开 WS 时移除监听器以防止内存泄漏，但保留后台运行的 PTY 进程
        ptyDataListener.dispose();
        console.log(`Session ${sessionId} WebSocket disconnected. Process kept alive.`);
    });
});

// 启动服务器
fastify.listen({ port: 3000, host: '0.0.0.0' }, (err) => {
    if (err) { fastify.log.error(err); process.exit(1); }
});
