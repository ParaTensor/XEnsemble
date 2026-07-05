const { ensureProjectRuntime } = require('../runtime/RuntimeService');
const { ensureAgentBootstrap } = require('../workspace/agentBootstrap');
const { buildPreflightReport } = require('../workspace/preflight');
const { appendInboxLog } = require('../workspace/logInbox');
const deploymentService = require('../deployments/DeploymentService');
const policy = require('../auth/PolicyService');
const { sendPublicError, sanitizePublicError } = require('../http/publicError');
const { RuntimeError } = require('../runtime/interfaces');

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

    fastify.post('/api/v1/projects/:projectId/agents/ensure-preview', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.projectId);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const previewQuota = await policy.checkQuota(request.user.id, 'previews', request.user.role);
        if (!previewQuota.ok) return policy.quotaErrorReply(reply, previewQuota);

        try {
            return await deploymentService.ensurePreview(request.user.id, project);
        } catch (err) {
            request.log.error(err);
            const code = err instanceof RuntimeError ? err.statusCode : 503;
            const { message } = sanitizePublicError(err, 'Ensure preview failed');
            return reply.code(code).send({ error: message });
        }
    });

    fastify.post('/api/v1/projects/:projectId/agents/log', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.projectId);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const message = request.body?.message;
        if (!message) return reply.code(400).send({ error: 'message is required' });

        const level = request.body?.level || 'log';
        const tag = request.body?.source || 'browser';
        try {
            const { workspacePath } = await ensureProjectRuntime(project);
            appendInboxLog(workspacePath, tag, `${level}: ${message}`);
            return { ok: true };
        } catch (err) {
            request.log.error(err);
            return sendPublicError(reply, err, 'Failed to append log', 500);
        }
    });
}

module.exports = { registerWorkspaceRoutes };
