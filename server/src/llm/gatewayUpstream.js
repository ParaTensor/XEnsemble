const gatewaySettings = require('../admin/GatewaySettings');
const unigateway = require('../gateway/unigatewayManager');

async function resolveExternalGatewayUrl() {
    const fromEnv = process.env.LLM_GATEWAY_UPSTREAM_URL?.trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');

    const config = await gatewaySettings.getConfig();
    return config.upstream_url?.trim()
        ? config.upstream_url.trim().replace(/\/+$/, '')
        : null;
}

async function resolveGatewayUpstreamUrl(log = console) {
    const external = await resolveExternalGatewayUrl();
    if (external) return external;

    const status = await unigateway.ensureRunning(log);
    if (!status.running) {
        const message = status.lastError || 'UniGateway is not running';
        return { error: message, status: 503 };
    }
    return status.baseUrl;
}

module.exports = { resolveGatewayUpstreamUrl, resolveExternalGatewayUrl };
