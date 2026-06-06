const userAdmin = require('../admin/UserAdminService');
const platformSettings = require('../admin/PlatformSettings');

function registerAdminRoutes(fastify) {
    const adminPre = [fastify.authenticate, fastify.requireAdmin];

    fastify.get('/api/v1/admin/users', { preValidation: adminPre }, async () => {
        return userAdmin.listUsers();
    });

    fastify.post('/api/v1/admin/users', { preValidation: adminPre }, async (request, reply) => {
        try {
            const body = request.body || {};
            const user = await userAdmin.createUser({
                username: body.username,
                password: body.password,
                role: body.role,
                status: body.status,
                displayName: body.display_name,
                email: body.email,
                quota: body.quota,
                agentIds: body.agent_ids,
            }, request.user.id);
            return reply.code(201).send(user);
        } catch (err) {
            return reply.code(err.statusCode || 400).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/admin/users/:id', { preValidation: adminPre }, async (request, reply) => {
        const user = await userAdmin.getUserDetail(request.params.id);
        if (!user) return reply.code(404).send({ error: 'User not found' });
        return user;
    });

    fastify.patch('/api/v1/admin/users/:id', { preValidation: adminPre }, async (request, reply) => {
        try {
            const user = await userAdmin.updateUser(request.params.id, request.body || {}, request.user.id);
            if (!user) return reply.code(404).send({ error: 'User not found' });
            return user;
        } catch (err) {
            return reply.code(err.statusCode || 400).send({ error: err.message });
        }
    });

    fastify.delete('/api/v1/admin/users/:id', { preValidation: adminPre }, async (request, reply) => {
        try {
            const user = await userAdmin.suspendUser(request.params.id, request.user.id);
            if (!user) return reply.code(404).send({ error: 'User not found' });
            return user;
        } catch (err) {
            return reply.code(err.statusCode || 400).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/admin/users/:id/quota', { preValidation: adminPre }, async (request, reply) => {
        const user = await userAdmin.getUserById(request.params.id);
        if (!user) return reply.code(404).send({ error: 'User not found' });
        const policy = require('../auth/PolicyService');
        return policy.getEffectiveQuota(request.params.id);
    });

    fastify.put('/api/v1/admin/users/:id/quota', { preValidation: adminPre }, async (request, reply) => {
        const user = await userAdmin.getUserById(request.params.id);
        if (!user) return reply.code(404).send({ error: 'User not found' });
        try {
            return await userAdmin.setUserQuota(request.params.id, request.body || {}, request.user.id);
        } catch (err) {
            return reply.code(err.statusCode || 400).send({ error: err.message });
        }
    });

    fastify.put('/api/v1/admin/users/:id/agents', { preValidation: adminPre }, async (request, reply) => {
        const user = await userAdmin.getUserById(request.params.id);
        if (!user) return reply.code(404).send({ error: 'User not found' });
        try {
            const agentIds = request.body?.agent_ids || [];
            await userAdmin.setUserAgents(request.params.id, agentIds, request.user.id);
            return { agent_ids: agentIds };
        } catch (err) {
            return reply.code(err.statusCode || 400).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/users/:id/agents/:agentId', { preValidation: adminPre }, async (request, reply) => {
        const user = await userAdmin.getUserById(request.params.id);
        if (!user) return reply.code(404).send({ error: 'User not found' });
        try {
            await userAdmin.grantAgent(request.params.id, request.params.agentId, request.user.id);
            return { ok: true };
        } catch (err) {
            return reply.code(err.statusCode || 400).send({ error: err.message });
        }
    });

    fastify.delete('/api/v1/admin/users/:id/agents/:agentId', { preValidation: adminPre }, async (request, reply) => {
        const user = await userAdmin.getUserById(request.params.id);
        if (!user) return reply.code(404).send({ error: 'User not found' });
        await userAdmin.revokeAgent(request.params.id, request.params.agentId, request.user.id);
        return { ok: true };
    });

    fastify.post('/api/v1/admin/users/:id/reset-password', { preValidation: adminPre }, async (request, reply) => {
        const user = await userAdmin.getUserById(request.params.id);
        if (!user) return reply.code(404).send({ error: 'User not found' });
        const newPassword = request.body?.password || request.body?.new_password;
        try {
            await userAdmin.resetPassword(request.params.id, newPassword, request.user.id);
            return { ok: true };
        } catch (err) {
            return reply.code(err.statusCode || 400).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/admin/platform-settings', { preValidation: adminPre }, async () => {
        return platformSettings.getAll();
    });

    fastify.put('/api/v1/admin/platform-settings', { preValidation: adminPre }, async (request, reply) => {
        const mode = request.body?.registration_mode;
        const allowedModes = ['open', 'invite_only', 'admin_only', 'approval'];
        if (mode !== undefined && !allowedModes.includes(mode)) {
            return reply.code(400).send({ error: 'Invalid registration_mode' });
        }
        return platformSettings.updateAll(request.body || {});
    });
}

module.exports = { registerAdminRoutes };
