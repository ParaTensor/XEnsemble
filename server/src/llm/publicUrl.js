const gatewaySettings = require('../admin/GatewaySettings');

function resolveControlPlanePublicUrlSync() {
    const fromEnv = process.env.CONTROL_PLANE_PUBLIC_URL?.trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const port = Number(process.env.PORT) || 3000;
    return `http://127.0.0.1:${port}`;
}

async function resolveControlPlanePublicUrl() {
    const fromEnv = process.env.CONTROL_PLANE_PUBLIC_URL?.trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');

    try {
        const config = await gatewaySettings.getConfig();
        if (config.public_url?.trim()) {
            return config.public_url.trim().replace(/\/+$/, '');
        }
    } catch {
        /* fall through */
    }
    return resolveControlPlanePublicUrlSync();
}

function resolveLlmPublicRouterBaseSync() {
    return `${resolveControlPlanePublicUrlSync()}/api/v1/llm`;
}

async function resolveLlmPublicRouterBase() {
    return `${await resolveControlPlanePublicUrl()}/api/v1/llm`;
}

module.exports = {
    resolveControlPlanePublicUrl,
    resolveControlPlanePublicUrlSync,
    resolveLlmPublicRouterBase,
    resolveLlmPublicRouterBaseSync,
};
