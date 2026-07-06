const crypto = require('crypto');
const unigateway = require('../gateway/unigatewayManager');
const { requestGateway } = require('../gateway/adminProxy');

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

    await requestGateway('POST', '/api/admin/api-keys', {
        body: { key, service_id: serviceId },
        log,
    });

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
