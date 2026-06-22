/**
 * Provider registry — maps provider name → adapter class.
 *
 * Usage:
 *   const { getProvider } = require('./registry');
 *   const github = getProvider('github');
 *   const authUrl = github.buildAuthUrl({ clientId, callbackUrl, state, scope });
 */

const providers = new Map();

function registerProvider(name, AdapterClass) {
    providers.set(name, AdapterClass);
}

function getProvider(name) {
    const Adapter = providers.get(name);
    if (!Adapter) {
        throw new Error(`Unknown git provider: ${name}. Available: ${listProviders().join(', ')}`);
    }
    return new Adapter();
}

function listProviders() {
    return [...providers.keys()];
}

function hasProvider(name) {
    return providers.has(name);
}

// ── Register built-in adapters ──
const { GitHubAdapter } = require('./GitHubAdapter');
registerProvider('github', GitHubAdapter);

module.exports = { registerProvider, getProvider, listProviders, hasProvider };
