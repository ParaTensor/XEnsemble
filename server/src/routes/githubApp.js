/**
 * GitHub App routes — webhook receiver + admin management.
 *
 * POST /api/v1/github-app/webhook     — receive GitHub webhook events
 * GET  /api/v1/github-app/status      — check if GitHub App is configured
 * GET  /api/v1/github-app/installations — list installations (admin)
 * GET  /api/v1/github-app/installations/:id/repos — list repos for installation
 */

const { GitHubAppService } = require('../git/GitHubAppService');
const { handleWebhookEvent } = require('../git/webhookHandler');

function registerGitHubAppRoutes(fastify) {
    const appService = new GitHubAppService();

    // ── Webhook receiver ──

    fastify.post('/api/v1/github-app/webhook', {
        config: { rawBody: true },
    }, async (request, reply) => {
        const event = request.headers['x-github-event'];
        const signature = request.headers['x-hub-signature-256'];
        const deliveryId = request.headers['x-github-delivery'];

        if (!event) {
            return reply.code(400).send({ error: 'Missing X-GitHub-Event header' });
        }

        // Verify signature
        const rawBody = typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body);

        try {
            const valid = await appService.verifyWebhook(rawBody, signature);
            if (!valid) {
                request.log.warn({ deliveryId, event }, 'Webhook signature verification failed');
                return reply.code(401).send({ error: 'Invalid signature' });
            }
        } catch (err) {
            if (err.statusCode === 503) {
                // Webhook secret not configured — accept but log warning
                request.log.warn('Webhook secret not configured, skipping verification');
            } else {
                throw err;
            }
        }

        const payload = typeof request.body === 'string'
            ? JSON.parse(request.body)
            : request.body;

        try {
            const result = await handleWebhookEvent(event, payload);
            request.log.info({ deliveryId, event, result }, 'Webhook processed');
            return { ok: true, event, delivery_id: deliveryId, ...result };
        } catch (err) {
            request.log.error({ err, deliveryId, event }, 'Webhook handler error');
            return reply.code(500).send({ error: 'Webhook processing failed' });
        }
    });

    // ── App status (any authenticated user) ──

    fastify.get('/api/v1/github-app/status', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        try {
            const app = await appService.getApp();
            return { configured: true, app };
        } catch (err) {
            if (err.statusCode === 503) {
                return { configured: false };
            }
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    // ── Installations (admin only) ──

    fastify.get('/api/v1/github-app/installations', {
        preValidation: [fastify.authenticate, fastify.requireAdmin],
    }, async (request, reply) => {
        try {
            const installations = await appService.listInstallations();
            return { installations };
        } catch (err) {
            request.log.error(err);
            const code = err.statusCode || 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    // ── Installation repos ──

    fastify.get('/api/v1/github-app/installations/:installationId/repos', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const { installationId } = request.params;
        const { page, per_page } = request.query || {};

        try {
            const result = await appService.listInstallationRepos(installationId, {
                page: page ? Number(page) : 1,
                perPage: per_page ? Number(per_page) : 30,
            });
            return result;
        } catch (err) {
            request.log.error(err);
            const code = err.statusCode || 500;
            return reply.code(code).send({ error: err.message });
        }
    });
}

module.exports = { registerGitHubAppRoutes };
