const auth = require('./index');
const { assertActiveUser } = require('./assertActiveUser');

function registerAuthHooks(fastify) {
    fastify.decorate('authenticate', async function authenticate(request, reply) {
        try {
            const token = request.headers.authorization?.replace('Bearer ', '');
            if (!token) throw new Error('Missing token');
            const payload = auth.verifyAccessToken(token);
            if (!payload?.id) throw new Error('Invalid token');

            const active = await assertActiveUser(token);
            if (active.error) {
                if (active.status === 401) throw new Error(active.error);
                return reply.code(active.status).send({ error: active.code });
            }

            request.user = {
                id: active.user.id,
                username: payload.username,
                role: payload.role,
                status: active.user.status,
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
