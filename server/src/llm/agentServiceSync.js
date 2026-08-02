const fs = require('fs');
const path = require('path');
const agentGatewayConfig = require('../admin/AgentGatewayConfig');
const unigateway = require('../gateway/unigatewayManager');
const { parseProvidersFromToml } = require('../gateway/readProviderSecrets');
const { hasServiceBlock, hasBinding, appendAgentService } = require('./agentServiceToml');

const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'unigateway.toml');

async function syncAgentServiceBinding(agentId, log = console) {
    const cfg = await agentGatewayConfig.getForAgent(agentId);
    if (!cfg || cfg.llm_auth_mode !== 'gateway') return { synced: false, reason: 'not_gateway_mode' };
    const { resolveExternalGatewayUrl } = require('./gatewayUpstream');
    if (await resolveExternalGatewayUrl()) {
        return {
            synced: true,
            changed: false,
            agentId,
            reason: 'external_default_service',
        };
    }

    const providerName = cfg.provider?.trim();
    if (!providerName) return { synced: false, reason: 'no_provider' };

    if (!fs.existsSync(CONFIG_PATH)) {
        return { synced: false, reason: 'missing_config' };
    }

    const before = fs.readFileSync(CONFIG_PATH, 'utf8');
    const providers = parseProvidersFromToml(before);
    const providerExists = providers.some((p) => p.name === providerName);
    if (!providerExists) {
        return { synced: false, reason: 'provider_not_found', providerName };
    }

    const after = appendAgentService(before, agentId, providerName);
    if (after === before) return { synced: true, changed: false, agentId, providerName };

    fs.writeFileSync(CONFIG_PATH, after, { mode: 0o600 });
    log.info?.(`[llm] synced UniGateway service binding agent=${agentId} provider=${providerName}`);

    const status = unigateway.getStatus();
    if (status.running) {
        await unigateway.restart(log);
    }
    return { synced: true, changed: true, agentId, providerName };
}

async function syncAllAgentServiceBindings(log = console) {
    const all = await agentGatewayConfig.getAll();
    const results = [];
    for (const agentId of Object.keys(all)) {
        results.push(await syncAgentServiceBinding(agentId, log));
    }
    return results;
}

module.exports = {
    syncAgentServiceBinding,
    syncAllAgentServiceBindings,
};
