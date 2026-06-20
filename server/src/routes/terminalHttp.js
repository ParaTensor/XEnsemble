const auth = require('../auth/index');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const sessionManager = require('../session/SessionManager');
const { applyTerminalMessage, subscribeTerminal } = require('../session/terminalBridge');

function extractAccessToken(request) {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim();
    const q = request.query?.access_token;
    if (typeof q === 'string' && q.trim()) return q.trim();
    return null;
}

async function assertSessionOwner(userId, sessionId) {
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    if (rows.length === 0) return { ok: false, status: 404, error: 'Session not found' };
    if (rows[0].userId !== userId) return { ok: false, status: 403, error: 'Forbidden' };
    return { ok: true };
}

async function authenticateTerminalRequest(request, reply) {
    const token = extractAccessToken(request);
    if (!token) {
        reply.code(401).send({ error: 'Unauthorized' });
        return null;
    }
    const payload = auth.verifyAccessToken(token);
    if (!payload?.id) {
        reply.code(401).send({ error: 'Unauthorized' });
        return null;
    }
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, payload.id));
    if (rows.length === 0) {
        reply.code(401).send({ error: 'Unauthorized' });
        return null;
    }
    const user = rows[0];
    const status = user.status || 'active';
    if (status !== 'active') {
        const code = status === 'pending' ? 'account_pending' : 'account_suspended';
        reply.code(403).send({ error: code });
        return null;
    }
    return { id: user.id, username: user.username, role: user.role, status };
}

function writeSse(reply, payload) {
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function registerTerminalHttpRoutes(fastify) {
    fastify.get('/api/v1/terminal/stream', async (request, reply) => {
        const user = await authenticateTerminalRequest(request, reply);
        if (!user) return;

        const sessionId = request.query?.sessionId;
        if (!sessionId || typeof sessionId !== 'string') {
            return reply.code(400).send({ error: 'sessionId is required' });
        }

        const access = await assertSessionOwner(user.id, sessionId);
        if (!access.ok) {
            return reply.code(access.status).send({ error: access.error });
        }

        reply.hijack();
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        let streamEnded = false;
        const endStream = () => {
            if (streamEnded) return;
            streamEnded = true;
            try { reply.raw.end(); } catch (_) { /* already closed */ }
        };

        const send = (payload) => {
            if (streamEnded) return;
            if (payload.type === 'error' || payload.type === 'exit') {
                writeSse(reply, payload);
                endStream();
                return;
            }
            writeSse(reply, payload);
        };

        const sub = subscribeTerminal(sessionId, send);
        if (!sub.ok) {
            endStream();
            return;
        }

        const onClientClose = () => {
            sub.cleanup();
            endStream();
        };

        request.raw.on('close', onClientClose);
        request.raw.on('aborted', onClientClose);
    });

    fastify.post('/api/v1/terminal/input', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const sessionId = request.body?.session_id || request.body?.sessionId;
        const type = request.body?.type;
        if (!sessionId) return reply.code(400).send({ error: 'session_id is required' });
        if (!type) return reply.code(400).send({ error: 'type is required' });

        const access = await assertSessionOwner(request.user.id, sessionId);
        if (!access.ok) return reply.code(access.status).send({ error: access.error });

        if (!sessionManager.isAlive(sessionId)) {
            return reply.code(409).send({ error: 'Session is not active' });
        }

        const live = sessionManager.getSession(sessionId);
        if (!live?.handle) {
            return reply.code(404).send({ error: 'Session handle not found' });
        }

        applyTerminalMessage(live.handle, {
            type,
            data: request.body?.data,
            cols: request.body?.cols,
            rows: request.body?.rows,
        });
        return { ok: true };
    });
}

module.exports = { registerTerminalHttpRoutes };
