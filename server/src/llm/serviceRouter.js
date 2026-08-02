const crypto = require('crypto');
const unigateway = require('../gateway/unigatewayManager');
const { requestGateway } = require('../gateway/adminProxy');
const { resolveExternalGatewayUrl } = require('./gatewayUpstream');

const agentApiKeyCache = new Map();

function deriveAgentApiKey(agentId, gatewayKey) {
    const serviceId = String(agentId || '').trim() || 'default';
    return crypto
        .createHmac('sha256', gatewayKey)
        .update(`agent:${serviceId}`)
        .digest('base64url');
}

async function ensureAgentApiKey(agentId, log) {
    const serviceId = String(agentId || '').trim() || 'default';
    const cached = agentApiKeyCache.get(serviceId);
    if (cached) return cached;

    const secrets = unigateway.ensureGatewaySecrets();
    const key = deriveAgentApiKey(serviceId, secrets.gatewayKey);
    // External UniGateway instances cannot consume this control plane's local
    // TOML service bindings. Route per-agent keys through their configured
    // default service; local managed gateways keep the per-agent service.
    const gatewayServiceId = await resolveExternalGatewayUrl() ? 'default' : serviceId;

    const result = await requestGateway('POST', '/api/admin/api-keys', {
        body: { key, service_id: gatewayServiceId },
        log,
    });
    if (result.statusCode < 200 || result.statusCode >= 300) {
        const error = new Error(`Failed to register agent API key (status ${result.statusCode})`);
        error.statusCode = result.statusCode;
        throw error;
    }

    agentApiKeyCache.set(serviceId, key);
    return key;
}

function resetAgentApiKeyCacheForTests() {
    agentApiKeyCache.clear();
}

/**
 * Return a per-agent UniGateway API key.
 * The key is deterministically derived from the global gateway key and bound to the
 * agent's service, removing the need for a global rebind lock.
 */
async function getAgentGatewayKey(agentId, log) {
    return ensureAgentApiKey(agentId, log);
}

module.exports = { getAgentGatewayKey, resetAgentApiKeyCacheForTests };
