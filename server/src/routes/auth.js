const auth = require('../auth/index');
const userAdmin = require('../admin/UserAdminService');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');

function registerAuthRoutes(fastify) {
    fastify.post('/api/v1/auth/register', async (request, reply) => {
        const { username, password, device_name } = request.body || {};
        try {
            const { user, status, autoLogin } = await userAdmin.registerUser({ username, password });
            if (!autoLogin) {
                return reply.code(201).send({
                    message: 'Registration submitted. Await administrator approval.',
                    user: { id: user.id, username: user.username, status },
                });
            }
            const login = await userAdmin.loginUser(username, password, device_name);
            return {
                access_token: login.access_token,
                refresh_token: login.refresh_token,
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
        const { username, password, device_name } = request.body || {};
        try {
            const result = await userAdmin.loginUser(username, password, device_name);
            return {
                access_token: result.access_token,
                refresh_token: result.refresh_token,
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

    fastify.post('/api/v1/auth/refresh', async (request, reply) => {
        const { refresh_token, device_name } = request.body || {};
        if (!refresh_token) {
            return reply.code(400).send({ error: 'refresh_token is required' });
        }
        try {
            const tokenHash = auth.hashToken(refresh_token);
            const rows = await db.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, tokenHash));
            if (rows.length === 0 || rows[0].revokedAt || rows[0].expiresAt < Date.now()) {
                return reply.code(401).send({ error: 'Invalid or expired refresh token' });
            }
            const tokenRow = rows[0];
            const user = await userAdmin.getUserById(tokenRow.userId);
            if (!user || user.status !== 'active') {
                return reply.code(403).send({ error: 'account_inactive' });
            }
            await db.update(schema.refreshTokens).set({ revokedAt: Date.now() }).where(eq(schema.refreshTokens.id, tokenRow.id));
            const newRefreshToken = await userAdmin.createRefreshToken(user.id, device_name);
            const accessToken = auth.generateAccessToken(user);
            return { access_token: accessToken, refresh_token: newRefreshToken };
        } catch (err) {
            return reply.code(401).send({ error: 'Invalid refresh token' });
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
        await userAdmin.revokeAllUserRefreshTokens(request.user.id);
        return { ok: true };
    });
}

module.exports = { registerAuthRoutes };
