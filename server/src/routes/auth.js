const auth = require('../auth/index');
const userAdmin = require('../admin/UserAdminService');

function registerAuthRoutes(fastify) {
    fastify.post('/api/v1/auth/register', async (request, reply) => {
        const { username, password } = request.body || {};
        try {
            const { user, status, autoLogin } = await userAdmin.registerUser({ username, password });
            if (!autoLogin) {
                return reply.code(201).send({
                    message: 'Registration submitted. Await administrator approval.',
                    user: { id: user.id, username: user.username, status },
                });
            }
            const login = await userAdmin.loginUser(username, password);
            return {
                token: login.token,
                user: login.user,
                quotas: login.quotas,
            };
        } catch (err) {
            const code = err.statusCode || 400;
            const body = { error: err.message };
            if (err.code) body.code = err.code;
            return reply.code(code).send(body);
        }
    });

    fastify.post('/api/v1/auth/login', async (request, reply) => {
        const { username, password } = request.body || {};
        try {
            const result = await userAdmin.loginUser(username, password);
            return {
                token: result.token,
                user: result.user,
                quotas: result.quotas,
            };
        } catch (err) {
            const code = err.statusCode || 401;
            const body = { error: err.message };
            if (err.code) body.code = err.code;
            return reply.code(code).send(body);
        }
    });

    fastify.get('/api/v1/auth/me', { preValidation: [fastify.authenticate] }, async (request) => {
        return userAdmin.getMe(request.user.id);
    });

    fastify.put('/api/v1/auth/password', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { current_password, new_password } = request.body || {};
        if (!new_password || new_password.length < 8) {
            return reply.code(400).send({ error: 'New password must be at least 8 characters' });
        }
        const user = await userAdmin.getUserById(request.user.id);
        if (!user || !auth.verifyPassword(current_password, user.passwordHash)) {
            return reply.code(401).send({ error: 'Current password is incorrect' });
        }
        await userAdmin.resetPassword(request.user.id, new_password, request.user.id);
        return { ok: true };
    });
}

module.exports = { registerAuthRoutes };
