/** Default execution plane when RUNTIME_PROVIDER is unset. */
const DEFAULT_RUNTIME_PROVIDER = 'boxlite';

const SUPPORTED_RUNTIME_PROVIDERS = new Set(['local', 'boxlite', 'k8s']);

function resolveRuntimeProvider() {
    const raw = process.env.RUNTIME_PROVIDER?.trim();
    if (raw) return raw;
    return DEFAULT_RUNTIME_PROVIDER;
}

module.exports = {
    DEFAULT_RUNTIME_PROVIDER,
    SUPPORTED_RUNTIME_PROVIDERS,
    resolveRuntimeProvider,
};
