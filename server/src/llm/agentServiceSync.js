const fs = require('fs');
const path = require('path');
const agentGatewayConfig = require('../admin/AgentGatewayConfig');
const unigateway = require('../gateway/unigatewayManager');
const { parseProvidersFromToml } = require('../gateway/readProviderSecrets');
const { upsertAgentServiceBinding } = require('./agentServiceToml');

const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'unigateway.toml');

/**
 * Check if a provider exists in the UniGateway.
 * Providers may be configured via the admin API (stored in gateway memory)
 * or via the TOML file. Check both sources.
 */
async function providerExistsInGateway(providerName, log) {
    // First check the TOML file
    if (fs.existsSync(CONFIG_PATH)) {
        const toml = fs.readFileSync(CONFIG_PATH, 'utf8');
        const tomlProviders = parseProvidersFromToml(toml);
        if (tomlProviders.some((p) => p.name === providerName)) return true;
    }

    // Then check the UniGateway admin API (providers added via admin API
    // are stored in gateway memory, not persisted to the TOML file)
    const status = unigateway.getStatus();
    if (!status.running) return false;

    try {
        const { requestGateway } = require('../gateway/adminProxy');
        const result = await requestGateway('GET', '/api/admin/providers', { log });
        if (result.statusCode === 200 && result.body) {
            const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
            const providerList = body?.data || body || [];
            return Array.isArray(providerList) && providerList.some((p) => p.name === providerName);
        }
    } catch (err) {
        log?.warn?.(`[llm] failed to query providers from gateway admin API: ${err.message}`);
    }
    return false;
}

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

    const exists = await providerExistsInGateway(providerName, log);
    if (!exists) {
        return { synced: false, reason: 'provider_not_found', providerName };
    }

    if (!fs.existsSync(CONFIG_PATH)) {
        return { synced: false, reason: 'missing_config' };
    }

    const before = fs.readFileSync(CONFIG_PATH, 'utf8');
    const after = upsertAgentServiceBinding(before, agentId, providerName);
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
