const platformSettings = require('../admin/PlatformSettings');
const userPreferences = require('../admin/UserPreferences');
const terminalThemes = require('../config/terminalThemes');
const { previewSpawnEnv } = require('../agents/agentEnv');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const { sendPublicError } = require('../http/publicError');

function registerUserRoutes(fastify) {
    fastify.get('/api/v1/terminal-themes', { preValidation: [fastify.authenticate] }, async () => {
        const settings = await platformSettings.getAll();
        return terminalThemes.listPublicThemes({
            platformDefaultId: settings.default_terminal_theme_id,
            disabledIds: settings.disabled_terminal_theme_ids || [],
        });
    });

    fastify.get('/api/v1/user/preferences', { preValidation: [fastify.authenticate] }, async (request) => {
        return userPreferences.getPreferences(request.user.id);
    });

    fastify.put('/api/v1/user/preferences', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        try {
            return await userPreferences.updatePreferences(request.user.id, request.body || {});
        } catch (err) {
            return sendPublicError(reply, err, 'Failed to update preferences', 400);
        }
    });

    fastify.get('/api/v1/session/spawn-preview', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const agentId = request.query?.agent_id;
        if (!agentId) {
            return reply.code(400).send({ error: 'agent_id query parameter is required' });
        }
        const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
        if (rows.length === 0) return reply.code(404).send({ error: 'Agent not found' });
        const row = rows[0];
        try {
            return await previewSpawnEnv({
                userId: request.user.id,
                agentId: row.id,
                envRequired: JSON.parse(row.envRequired),
                terminalThemeId: request.query?.terminal_theme_id,
            });
        } catch (err) {
            return sendPublicError(reply, err, 'Failed to preview spawn env', 500);
        }
    });
}

module.exports = { registerUserRoutes };
