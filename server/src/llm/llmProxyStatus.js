const { resolveControlPlanePublicUrl, resolveLlmPublicRouterBase } = require('./publicUrl');
const gatewaySettings = require('../admin/GatewaySettings');

async function enrichLlmProxyStatus(status = {}) {
    const config = await gatewaySettings.getConfig();
    const envUpstream = process.env.LLM_GATEWAY_UPSTREAM_URL?.trim() || null;
    const gatewayUpstreamUrl = envUpstream || config.upstream_url || null;
    return {
        ...status,
        control_plane_public_url: await resolveControlPlanePublicUrl(),
        llm_proxy_url: await resolveLlmPublicRouterBase(),
        gateway_upstream_url: gatewayUpstreamUrl,
        external_upstream: Boolean(gatewayUpstreamUrl),
    };
}

module.exports = { enrichLlmProxyStatus };
