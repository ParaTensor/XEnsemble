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

    // Always restart so UniGateway reloads the updated TOML. Gating on
    // status.running leaves a stale process (loaded with old config) serving
    // and overwriting the new binding via persist_if_dirty().
    try {
        await unigateway.restart(log);
    } catch (err) {
        log.warn?.(`[llm] restart UniGateway failed: ${err.message}`);
    }
    return { synced: true, changed: true, agentId, providerName };
}

async function syncAllAgentServiceBindings(log = console) {
    const all = await agentGatewayConfig.getAll();
    const { resolveExternalGatewayUrl } = require('./gatewayUpstream');
    const isExternal = await resolveExternalGatewayUrl();

    // Phase 1: validate all agents and collect bindings to add
    const toSync = [];
    const results = [];
    for (const agentId of Object.keys(all)) {
        const cfg = all[agentId];
        if (!cfg || cfg.llm_auth_mode !== 'gateway') {
            results.push({ agentId, synced: false, reason: 'not_gateway_mode' });
            continue;
        }
        if (isExternal) {
            results.push({ agentId, synced: true, changed: false, reason: 'external_default_service' });
            continue;
        }
        const providerName = cfg.provider?.trim();
        if (!providerName) {
            results.push({ agentId, synced: false, reason: 'no_provider' });
            continue;
        }
        const exists = await providerExistsInGateway(providerName, log);
        if (!exists) {
            results.push({ agentId, synced: false, reason: 'provider_not_found', providerName });
            continue;
        }
        toSync.push({ agentId, providerName });
    }

    if (toSync.length === 0 || !fs.existsSync(CONFIG_PATH)) {
        if (toSync.length > 0) {
            for (const { agentId } of toSync) {
                results.push({ agentId, synced: false, reason: 'missing_config' });
            }
        }
        return results;
    }

    // Phase 2: apply ALL bindings in a single TOML write, then restart once
    let before = fs.readFileSync(CONFIG_PATH, 'utf8');
    let changed = false;
    for (const { agentId, providerName } of toSync) {
        const after = upsertAgentServiceBinding(before, agentId, providerName);
        if (after !== before) {
            before = after;
            changed = true;
            log.info?.(`[llm] queued binding agent=${agentId} provider=${providerName}`);
        }
        results.push({ agentId, synced: true, changed: after !== before, providerName });
    }

    if (changed) {
        fs.writeFileSync(CONFIG_PATH, before, { mode: 0o600 });
        log.info?.(`[llm] wrote ${toSync.length} bindings to UniGateway TOML`);

        // Always restart so UniGateway reloads the updated TOML. Do NOT gate on
        // status.running: a stale process (loaded with old config) would keep
        // serving and its persist_if_dirty() would overwrite the new bindings.
        try {
            await unigateway.restart(log);
        } catch (err) {
            log.warn?.(`[llm] restart UniGateway failed: ${err.message}`);
        }
    }

    return results;
}

module.exports = {
    syncAgentServiceBinding,
    syncAllAgentServiceBindings,
};
