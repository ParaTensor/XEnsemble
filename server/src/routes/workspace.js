const { ensureProjectRuntime } = require('../runtime/RuntimeService');
const { ensureAgentBootstrap } = require('../workspace/agentBootstrap');
const { buildPreflightReport } = require('../workspace/preflight');
const { sendPublicError } = require('../http/publicError');

function registerWorkspaceRoutes(fastify, { getProjectForUser }) {
    fastify.get('/api/v1/projects/:projectId/preflight', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.projectId);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const agentId = request.query?.agent_id || request.query?.agentId || null;
        try {
            return await buildPreflightReport({
                user: request.user,
                project,
                agentId,
            });
        } catch (err) {
            request.log.error(err);
            return sendPublicError(reply, err, 'Preflight check failed', 500);
        }
    });

    fastify.post('/api/v1/projects/:projectId/agents/setup', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.projectId);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const force = Boolean(request.body?.force);
        try {
            const { workspacePath } = await ensureProjectRuntime(project);
            const status = await ensureAgentBootstrap(project, workspacePath, { force });
            if (status?.status === 'failed') {
                return reply.code(500).send({
                    error: 'Workspace setup failed',
                    setup: status,
                });
            }
            return reply.code(200).send({ ok: true, setup: status });
        } catch (err) {
            request.log.error(err);
            return sendPublicError(reply, err, 'Workspace setup failed', 500);
        }
    });
}

module.exports = { registerWorkspaceRoutes };
