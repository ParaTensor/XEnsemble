const platformSecrets = require('../admin/PlatformSecrets');
const platformSettings = require('../admin/PlatformSettings');
const unigateway = require('../gateway/unigatewayManager');
const agentGatewayConfig = require('../admin/AgentGatewayConfig');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const auth = require('../auth/index');

const GATEWAY_BASE_URL_KEYS = [
    'ANTHROPIC_BASE_URL',
    'OPENAI_BASE_URL',
    'KIMI_BASE_URL',
];

/** Injected at spawn when not in the user/platform vault (official CLI defaults). */
const SPAWN_ENV_DEFAULTS = {
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    OPENAI_BASE_URL: 'https://api.openai.com/v1',
};

const GATEWAY_MODEL_ENV_KEYS = [
    'OPENAI_MODEL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'LLM_MODEL',
];

const GATEWAY_API_KEY_KEYS = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'KIMI_API_KEY',
    'DASHSCOPE_API_KEY',
    'ZAI_API_KEY',
    'MINIMAX_API_KEY',
    'QODER_PERSONAL_ACCESS_TOKEN',
    'AMP_API_KEY',
    'COHERE_API_KEY',
    'HERMES_API_KEY',
    'OPENCLAW_KEY',
];

async function getLlmAuthMode() {
    return platformSettings.getLlmAuthMode();
}

async function getUserSecrets(userId) {
    const rows = await db.select().from(schema.secrets).where(eq(schema.secrets.userId, userId));
    if (rows.length === 0) return {};
    return auth.decryptSecrets(rows[0].encryptedData);
}

async function resolvePlatformSecrets() {
    const platform = await platformSecrets.getRaw();
    await unigateway.applyRuntimeConfig();
    const gateway = unigateway.getStatus();
    const secrets = unigateway.ensureGatewaySecrets();
    return {
        ...platform,
        LLM_ROUTER_URL: platform.LLM_ROUTER_URL?.trim() || gateway.baseUrl,
        LLM_ROUTER_API_KEY: platform.LLM_ROUTER_API_KEY?.trim() || secrets.gatewayKey || gateway.gatewayKey,
    };
}

function applyGatewaySynthesis(platform) {
    const router = platform.LLM_ROUTER_URL?.trim();
    if (!router) return { ...platform };

    const out = { ...platform };
    for (const key of GATEWAY_BASE_URL_KEYS) {
        if (!out[key]?.trim()) out[key] = router;
    }

    const token = platform.LLM_ROUTER_API_KEY?.trim();
    if (token) {
        for (const key of GATEWAY_API_KEY_KEYS) {
            if (!out[key]?.trim()) out[key] = token;
        }
    }
    return out;
}

function pickEnvRequired(env, envRequired) {
    const picked = {};
    for (const key of envRequired) {
        if (env[key] != null && String(env[key]).trim() !== '') {
            picked[key] = env[key];
        }
    }
    return picked;
}

function applySpawnDefaults(env, envRequired) {
    const out = { ...env };
    if (envRequired.includes('ANTHROPIC_API_KEY') && !out.ANTHROPIC_BASE_URL?.trim()) {
        out.ANTHROPIC_BASE_URL = SPAWN_ENV_DEFAULTS.ANTHROPIC_BASE_URL;
    }
    if (envRequired.includes('OPENAI_API_KEY') && !out.OPENAI_BASE_URL?.trim()) {
        out.OPENAI_BASE_URL = SPAWN_ENV_DEFAULTS.OPENAI_BASE_URL;
    }
    return out;
}

function findMissing(env, envRequired) {
    return envRequired.filter((k) => !env[k]?.trim());
}

/**
 * Resolve PTY env for an agent session.
 * - gateway: platform vault (+ LLM_ROUTER_URL synthesis); users do not supply keys.
 * - byok: user vault for env_required only; interactive-login agents use empty env_required.
 */
async function applyAgentGatewayModel(agentId, env) {
    const cfg = await agentGatewayConfig.getForAgent(agentId);
    if (!cfg?.model?.trim()) return env;
    const out = { ...env };
    for (const key of GATEWAY_MODEL_ENV_KEYS) {
        out[key] = cfg.model.trim();
    }
    return out;
}

async function resolveAgentAuthMode(agentId) {
    return agentGatewayConfig.getAgentAuthMode(agentId);
}

async function resolveSpawnEnv({ userId, agentId, envRequired }) {
    const mode = await resolveAgentAuthMode(agentId);
    const platform = applyGatewaySynthesis(await resolvePlatformSecrets());

    if (mode === 'gateway') {
        let env = pickEnvRequired(platform, envRequired);
        if (envRequired.length > 0 && !platform.LLM_ROUTER_URL?.trim()) {
            const missing = findMissing(env, envRequired);
            if (missing.length > 0) {
                return {
                    mode,
                    env: null,
                    missing,
                    error: 'Platform LLM gateway is not configured. Ask an admin to start the gateway under Settings → Gateway.',
                };
            }
        }
        const missing = findMissing(env, envRequired);
        if (missing.length > 0) {
            return {
                mode,
                env: null,
                missing,
                error: `Missing platform API key: ${missing[0]}. Ask an admin to configure gateway keys under Agents → Keys.`,
            };
        }
        env = await applyAgentGatewayModel(agentId, applySpawnDefaults({ ...platform, ...env }, envRequired));
        return { mode, env, missing: [] };
    }

    const user = await getUserSecrets(userId);
    const env = applySpawnDefaults(pickEnvRequired(user, envRequired), envRequired);
    const missing = findMissing(env, envRequired);
    if (missing.length > 0) {
        return {
            mode,
            env: null,
            missing,
            error: `Missing required keys: ${missing.join(', ')}. Configure them in Settings or before launch.`,
        };
    }
    return { mode, env, missing: [] };
}

async function isAgentKeysReady(envRequired, userId, agentId) {
    const mode = await resolveAgentAuthMode(agentId);
    if (mode === 'gateway') {
        const cfg = await agentGatewayConfig.getForAgent(agentId);
        if (!cfg?.model?.trim()) return false;
        if (envRequired.length === 0) return true;
        const platform = applyGatewaySynthesis(await resolvePlatformSecrets());
        return findMissing(pickEnvRequired(platform, envRequired), envRequired).length === 0;
    }
    if (envRequired.length === 0) return true;
    const user = await getUserSecrets(userId);
    return findMissing(pickEnvRequired(user, envRequired), envRequired).length === 0;
}

module.exports = {
    getLlmAuthMode,
    resolveAgentAuthMode,
    getUserSecrets,
    applyGatewaySynthesis,
    resolveSpawnEnv,
    isAgentKeysReady,
    findMissing,
};
