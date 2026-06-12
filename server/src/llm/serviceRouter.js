const unigateway = require('../gateway/unigatewayManager');
const { requestGateway } = require('../gateway/adminProxy');

let lock = Promise.resolve();

/**
 * Serialize UniGateway api-key rebind so concurrent sessions route to the correct service.
 */
async function withAgentService(agentId, log, fn) {
    const run = lock.then(async () => {
        const secrets = unigateway.ensureGatewaySecrets();
        const serviceId = String(agentId || '').trim() || 'default';
        await requestGateway('PATCH', '/api/admin/api-keys', {
            body: { key: secrets.gatewayKey, service_id: serviceId },
            log,
        });
        return fn();
    });
    lock = run.catch(() => {});
    return run;
}

module.exports = { withAgentService };
