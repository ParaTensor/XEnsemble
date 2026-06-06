const http = require('http');
const https = require('https');
const { URL } = require('url');
const unigateway = require('./unigatewayManager');
const gatewaySettings = require('../admin/GatewaySettings');
const platformSecrets = require('../admin/PlatformSecrets');
const { fetchProviderModels } = require('./fetchProviderModels');
const { testProviderConnectivity } = require('./testProviderConnectivity');
const { readProviderCredentials } = require('./readProviderSecrets');
const { maskApiKey } = require('./maskApiKey');

async function requestGateway(method, pathname, { body, query, log } = {}) {
    const status = await unigateway.ensureRunning(log);
    if (!status.running) {
        const message = status.lastError || 'UniGateway is not running';
        return Promise.reject(Object.assign(new Error(message), { statusCode: 503 }));
    }

    const url = new URL(pathname, status.baseUrl);
    if (query) {
        Object.entries(query).forEach(([key, value]) => {
            if (value != null) url.searchParams.set(key, String(value));
        });
    }

    const payload = body != null ? JSON.stringify(body) : null;
    const client = url.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
        const req = client.request(
            url,
            {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': status.adminToken || '',
                },
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => {
                    let parsed = raw;
                    try {
                        parsed = raw ? JSON.parse(raw) : null;
                    } catch {
                        /* keep text */
                    }
                    resolve({ statusCode: res.statusCode || 500, body: parsed });
                });
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function registerGatewayAdminRoutes(fastify) {
    const adminPre = [fastify.authenticate, fastify.requireAdmin];

    fastify.get('/api/v1/admin/gateway/status', { preValidation: adminPre }, async () => {
        return unigateway.refreshRunningState();
    });

    fastify.get('/api/v1/admin/gateway/config', { preValidation: adminPre }, async () => {
        const config = await gatewaySettings.getConfig();
        const status = unigateway.getStatus();
        return { ...config, env_bind_locked: status.envBindLocked };
    });

    fastify.patch('/api/v1/admin/gateway/config', { preValidation: adminPre }, async (request, reply) => {
        try {
            const body = request.body || {};
            const config = await gatewaySettings.updateConfig(body);
            await unigateway.applyRuntimeConfig();
            await unigateway.syncPlatformRouterSecrets(platformSecrets);
            const status = unigateway.getStatus();
            const restartRequested = body.restart === true;
            if (restartRequested && status.running) {
                const restarted = await unigateway.restart(fastify.log);
                if (restarted.running) {
                    await unigateway.syncPlatformRouterSecrets(platformSecrets);
                }
                return { ...config, env_bind_locked: status.envBindLocked, ...restarted };
            }
            return { ...config, env_bind_locked: status.envBindLocked, ...unigateway.getStatus() };
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/gateway/start', { preValidation: adminPre }, async (request, reply) => {
        try {
            const started = await unigateway.start(fastify.log, { force: Boolean(request.body?.force) });
            if (started.running) {
                await unigateway.syncPlatformRouterSecrets(platformSecrets);
            }
            return started;
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/gateway/stop', { preValidation: adminPre }, async () => {
        unigateway.stop();
        return unigateway.getStatus();
    });

    fastify.post('/api/v1/admin/gateway/restart', { preValidation: adminPre }, async (request, reply) => {
        try {
            const restarted = await unigateway.restart(fastify.log);
            if (restarted.running) {
                await unigateway.syncPlatformRouterSecrets(platformSecrets);
            }
            return restarted;
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/admin/gateway/modes', { preValidation: adminPre }, async (request, reply) => {
        try {
            const detailed = request.query?.detailed === 'true';
            const result = await requestGateway('GET', '/api/admin/modes', { query: { detailed }, log: fastify.log });
            return reply.code(result.statusCode).send(result.body);
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/gateway/default-mode', { preValidation: adminPre }, async (request, reply) => {
        try {
            const result = await requestGateway('POST', '/api/admin/preferences/default-mode', {
                body: request.body || {},
                log: fastify.log,
            });
            return reply.code(result.statusCode).send(result.body);
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.patch('/api/v1/admin/gateway/api-keys', { preValidation: adminPre }, async (request, reply) => {
        try {
            const result = await requestGateway('PATCH', '/api/admin/api-keys', {
                body: request.body || {},
                log: fastify.log,
            });
            return reply.code(result.statusCode).send(result.body);
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/admin/gateway/providers', { preValidation: adminPre }, async (request, reply) => {
        try {
            const result = await requestGateway('GET', '/api/admin/providers', { log: fastify.log });
            const body = result.body && typeof result.body === 'object' ? { ...result.body } : result.body;
            if (body?.data && Array.isArray(body.data)) {
                body.data = body.data.map((provider) => {
                    const creds = readProviderCredentials(provider.name);
                    const apiKey = creds?.api_key || '';
                    return {
                        ...provider,
                        api_key_masked: apiKey ? maskApiKey(apiKey) : '',
                    };
                });
            }
            return reply.code(result.statusCode).send(body);
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/admin/gateway/providers/:name/api-key', { preValidation: adminPre }, async (request, reply) => {
        try {
            const name = String(request.params.name || '').trim();
            const creds = readProviderCredentials(name);
            if (!creds) {
                return reply.code(404).send({ error: `Provider "${name}" not found.` });
            }
            if (!creds.api_key) {
                return reply.code(404).send({ error: 'No API Key configured.' });
            }
            return { success: true, data: { api_key: creds.api_key } };
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/gateway/providers/:name/fetch-models', { preValidation: adminPre }, async (request, reply) => {
        try {
            const name = String(request.params.name || '').trim();
            const creds = readProviderCredentials(name);
            if (!creds) {
                return reply.code(404).send({ error: `Provider "${name}" not found.` });
            }
            if (!creds.base_url) {
                return reply.code(400).send({ error: 'Provider has no Base URL configured.' });
            }
            if (!creds.api_key) {
                return reply.code(400).send({ error: 'Provider has no API Key configured.' });
            }
            const result = await fetchProviderModels({
                base_url: creds.base_url,
                api_key: creds.api_key,
            });
            return { success: true, data: result };
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/gateway/providers/fetch-models', { preValidation: adminPre }, async (request, reply) => {
        try {
            const { base_url, api_key } = request.body || {};
            const result = await fetchProviderModels({ base_url, api_key });
            return { success: true, data: result };
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/gateway/providers/test', { preValidation: adminPre }, async (request, reply) => {
        try {
            const { base_url, api_key, model, default_model, models } = request.body || {};
            const result = await testProviderConnectivity({ base_url, api_key, model, default_model, models });
            return { success: true, data: result };
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/gateway/providers/:name/test', { preValidation: adminPre }, async (request, reply) => {
        try {
            const name = String(request.params.name || '').trim();
            const creds = readProviderCredentials(name);
            if (!creds) {
                return reply.code(404).send({ error: `Provider "${name}" not found.` });
            }
            if (!creds.base_url) {
                return reply.code(400).send({ error: 'Provider has no Base URL configured.' });
            }
            if (!creds.api_key) {
                return reply.code(400).send({ error: 'Provider has no API Key configured.' });
            }
            const result = await testProviderConnectivity({
                base_url: creds.base_url,
                api_key: creds.api_key,
                default_model: creds.default_model,
                models: creds.models,
            });
            return { success: true, data: result };
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/admin/gateway/providers', { preValidation: adminPre }, async (request, reply) => {
        try {
            const result = await requestGateway('POST', '/api/admin/providers', {
                body: request.body || {},
                log: fastify.log,
            });
            return reply.code(result.statusCode).send(result.body);
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.patch('/api/v1/admin/gateway/providers/:name', { preValidation: adminPre }, async (request, reply) => {
        try {
            const name = encodeURIComponent(request.params.name);
            const result = await requestGateway('PATCH', `/api/admin/providers/${name}`, {
                body: request.body || {},
                log: fastify.log,
            });
            return reply.code(result.statusCode).send(result.body);
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });

    fastify.delete('/api/v1/admin/gateway/providers/:name', { preValidation: adminPre }, async (request, reply) => {
        try {
            const name = encodeURIComponent(request.params.name);
            const result = await requestGateway('DELETE', `/api/admin/providers/${name}`, { log: fastify.log });
            return reply.code(result.statusCode).send(result.body);
        } catch (err) {
            return reply.code(err.statusCode || 500).send({ error: err.message });
        }
    });
}

module.exports = { registerGatewayAdminRoutes, requestGateway };
