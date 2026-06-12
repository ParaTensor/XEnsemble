const { resolveControlPlanePublicUrl, resolveLlmPublicRouterBase } = require('./publicUrl');
const gatewaySettings = require('../admin/GatewaySettings');

async function enrichLlmProxyStatus(status = {}) {
    const config = await gatewaySettings.getConfig();
    return {
        ...status,
        control_plane_public_url: await resolveControlPlanePublicUrl(),
        llm_proxy_url: await resolveLlmPublicRouterBase(),
        gateway_upstream_url: config.upstream_url || null,
        external_upstream: Boolean(
            process.env.LLM_GATEWAY_UPSTREAM_URL?.trim() || config.upstream_url?.trim(),
        ),
    };
}

module.exports = { enrichLlmProxyStatus };
