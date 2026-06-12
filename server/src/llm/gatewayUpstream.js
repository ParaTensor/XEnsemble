const gatewaySettings = require('../admin/GatewaySettings');
const unigateway = require('../gateway/unigatewayManager');

async function resolveGatewayUpstreamUrl(log = console) {
    const fromEnv = process.env.LLM_GATEWAY_UPSTREAM_URL?.trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');

    const config = await gatewaySettings.getConfig();
    if (config.upstream_url?.trim()) {
        return config.upstream_url.trim().replace(/\/+$/, '');
    }

    const status = await unigateway.ensureRunning(log);
    if (!status.running) {
        const message = status.lastError || 'UniGateway is not running';
        return { error: message, status: 503 };
    }
    return status.baseUrl;
}

module.exports = { resolveGatewayUpstreamUrl };
