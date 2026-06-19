const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const auth = require('./index');

function registerAuthHooks(fastify) {
    fastify.decorate('authenticate', async function authenticate(request, reply) {
        try {
            const token = request.headers.authorization?.replace('Bearer ', '');
            if (!token) throw new Error('Missing token');
            const payload = auth.verifyAccessToken(token);
            if (!payload?.id) throw new Error('Invalid token');

            const rows = await db.select().from(schema.users).where(eq(schema.users.id, payload.id));
            if (rows.length === 0) throw new Error('User not found');

            const user = rows[0];
            const status = user.status || 'active';
            if (status !== 'active') {
                const code = status === 'pending' ? 'account_pending' : 'account_suspended';
                return reply.code(403).send({ error: code });
            }

            request.user = {
                id: user.id,
                username: user.username,
                role: user.role,
                status,
            };
        } catch (err) {
            if (!reply.sent) {
                reply.code(401).send({ error: 'Unauthorized' });
            }
        }
    });

    fastify.decorate('requireActive', async function requireActive(request, reply) {
        if (reply.sent) return;
        if (!request.user || request.user.status !== 'active') {
            return reply.code(403).send({ error: 'account_inactive' });
        }
    });

    fastify.decorate('requireAdmin', async function requireAdmin(request, reply) {
        if (reply.sent) return;
        if (!request.user || request.user.role !== 'admin') {
            return reply.code(403).send({ error: 'Forbidden' });
        }
    });
}

module.exports = { registerAuthHooks };
