const platformSecrets = require('../admin/PlatformSecrets');
const platformSettings = require('../admin/PlatformSettings');
const unigateway = require('../gateway/unigatewayManager');
const agentGatewayConfig = require('../admin/AgentGatewayConfig');
const { resolveLlmPublicRouterBase } = require('../llm/publicUrl');
const { TOKEN_PREFIX } = require('../llm/sessionToken');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const auth = require('../auth/index');

const GATEWAY_BASE_URL_KEYS = [
    'ANTHROPIC_BASE_URL',
    'OPENAI_BASE_URL',
    'KIMI_BASE_URL',
    'OPENROUTER_BASE_URL',
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
    'OPENROUTER_API_KEY',
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

async function resolvePlatformSecrets({ sessionToken, forPreview = false } = {}) {
    const platform = await platformSecrets.getRaw();
    await unigateway.applyRuntimeConfig();
    const secrets = unigateway.ensureGatewaySecrets();
    let routerKey = sessionToken?.trim() || '';
    if (!routerKey && !forPreview) {
        routerKey = platform.LLM_ROUTER_API_KEY?.trim()
            || secrets.gatewayKey
            || unigateway.getStatus().gatewayKey
            || '';
    }
    return {
        ...platform,
        LLM_ROUTER_URL: await resolveLlmPublicRouterBase(),
        LLM_ROUTER_API_KEY: routerKey,
    };
}

function openRouterCompatibleBaseUrl(router) {
    const base = String(router || '').trim().replace(/\/+$/, '');
    if (!base) return '';
    return base.endsWith('/v1') ? base : `${base}/v1`;
}

function applyGatewaySynthesis(platform) {
    const router = platform.LLM_ROUTER_URL?.trim();
    if (!router) return { ...platform };

    const out = { ...platform };
    const openRouterBase = openRouterCompatibleBaseUrl(router);
    if (openRouterBase) {
        out.OPENROUTER_BASE_URL = openRouterBase;
    }
    for (const key of GATEWAY_BASE_URL_KEYS) {
        if (key === 'OPENROUTER_BASE_URL') continue;
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
    if (agentId === 'hermes') {
        out.HERMES_MODEL = cfg.model.trim();
    }
    return out;
}

async function resolveAgentAuthMode(agentId) {
    return agentGatewayConfig.getAgentAuthMode(agentId);
}

function applyGatewayAgentEnv(agentId, env, platform, envRequired) {
    const out = { ...env };
    if (envRequired.includes('OPENROUTER_API_KEY') && platform.OPENROUTER_BASE_URL?.trim()) {
        out.OPENROUTER_BASE_URL = platform.OPENROUTER_BASE_URL.trim();
    }
    return out;
}

function applyAgentEnvOverrides(env, cfg) {
    if (!cfg?.env_overrides) return env;
    const out = { ...env };
    for (const [key, raw] of Object.entries(cfg.env_overrides)) {
        const trimmed = raw != null ? String(raw).trim() : '';
        if (trimmed) out[key] = trimmed;
    }
    return out;
}

async function buildGatewaySpawnEnv(agentId, envRequired, { draftModel, draftEnvOverrides, sessionToken, forPreview = false } = {}) {
    const cfg = await agentGatewayConfig.getForAgent(agentId);
    const model = (draftModel ?? cfg?.model ?? '').trim();
    const platform = applyGatewaySynthesis(await resolvePlatformSecrets({ sessionToken, forPreview }));

    let env = pickEnvRequired(platform, envRequired);
    if (model) {
        env = { ...env };
        for (const key of GATEWAY_MODEL_ENV_KEYS) env[key] = model;
        if (agentId === 'hermes') env.HERMES_MODEL = model;
    }
    env = applySpawnDefaults({ ...platform, ...env }, envRequired);
    env = applyGatewayAgentEnv(agentId, env, platform, envRequired);

    const defaults = {
        OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || platform.OPENROUTER_API_KEY || '',
        OPENROUTER_BASE_URL: env.OPENROUTER_BASE_URL || platform.OPENROUTER_BASE_URL || openRouterCompatibleBaseUrl(platform.LLM_ROUTER_URL) || '',
    };

    if (draftEnvOverrides && typeof draftEnvOverrides === 'object') {
        env = applyAgentEnvOverrides(env, { env_overrides: draftEnvOverrides });
    } else {
        env = applyAgentEnvOverrides(env, cfg);
    }

    return { env, cfg, model, platform, defaults };
}

async function resolveSpawnEnv({ userId, agentId, envRequired, sessionToken, projectId } = {}) {
    const mode = await resolveAgentAuthMode(agentId);
    const platform = applyGatewaySynthesis(await resolvePlatformSecrets({ sessionToken }));

    if (mode === 'gateway') {
        if (!sessionToken?.trim()) {
            return {
                mode,
                env: null,
                missing: [],
                error: 'Session LLM token is required for gateway mode.',
            };
        }
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
        env = applyGatewayAgentEnv(agentId, env, platform, envRequired);
        env = applyAgentEnvOverrides(env, await agentGatewayConfig.getForAgent(agentId));
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
        return unigateway.getStatus().running;
    }
    if (envRequired.length === 0) return true;
    const user = await getUserSecrets(userId);
    return findMissing(pickEnvRequired(user, envRequired), envRequired).length === 0;
}

function maskEnvValue(key, value) {
    if (!value?.trim()) return '—';
    if (/URL|BASE/i.test(key)) return value.trim();
    const trimmed = value.trim();
    if (trimmed.length <= 8) return '••••••••';
    return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function describeGatewayEnvSource(key) {
    if (key === 'OPENROUTER_BASE_URL') return 'Router Base URL (+ /v1)';
    if (GATEWAY_API_KEY_KEYS.includes(key)) return 'Session token (issued at start)';
    if (GATEWAY_BASE_URL_KEYS.includes(key)) return 'Control plane LLM proxy';
    return 'Platform gateway';
}

async function previewGatewaySpawnEnv(agentId, { envRequired = [], cmd, args = [], draftModel, draftEnvOverrides, draftAuthMode } = {}) {
    const savedMode = await resolveAgentAuthMode(agentId);
    const mode = draftAuthMode === 'gateway' || draftAuthMode === 'byok' ? draftAuthMode : savedMode;
    const gateway = unigateway.getStatus();

    if (mode !== 'gateway') {
        return {
            mode,
            ready: false,
            gateway_running: gateway.running,
            error: 'Agent is not in gateway mode.',
        };
    }

    const { env, model, platform, defaults } = await buildGatewaySpawnEnv(agentId, envRequired, {
        draftModel,
        draftEnvOverrides,
        forPreview: true,
    });
    const routerUrl = platform.LLM_ROUTER_URL?.trim() || '';
    const missingKeys = !model ? ['model'] : [];

    const fields = [];
    const effectiveEnvRequired = envRequired.includes('OPENROUTER_API_KEY') || agentId === 'hermes'
        ? [...new Set([...envRequired.filter((k) => k !== 'HERMES_API_KEY'), 'OPENROUTER_API_KEY'])]
        : envRequired;
    if (effectiveEnvRequired.includes('OPENROUTER_API_KEY') || agentId === 'hermes') {
        fields.push({
            key: 'OPENROUTER_API_KEY',
            label: 'OpenRouter API Key',
            source: describeGatewayEnvSource('OPENROUTER_API_KEY'),
            value: '',
            default_value: '',
            placeholder: `${TOKEN_PREFIX}… (issued at session start)`,
            password: true,
        });
    }
    if (env.OPENROUTER_BASE_URL || envRequired.includes('OPENROUTER_API_KEY')) {
        fields.push({
            key: 'OPENROUTER_BASE_URL',
            label: 'OpenRouter Base URL',
            source: describeGatewayEnvSource('OPENROUTER_BASE_URL'),
            value: env.OPENROUTER_BASE_URL || '',
            default_value: defaults.OPENROUTER_BASE_URL || '',
            password: false,
        });
    }

    const launchArgs = Array.isArray(args) ? args : [];
    const ready = Boolean(model)
        && missingKeys.length === 0
        && Boolean(routerUrl)
        && gateway.running;

    return {
        mode,
        ready,
        gateway_running: gateway.running,
        router_base_url: routerUrl || null,
        session_token_prefix: TOKEN_PREFIX,
        openrouter_base_url: env.OPENROUTER_BASE_URL || null,
        model: model || null,
        missing_keys: missingKeys,
        defaults,
        fields,
        launch: {
            cmd: cmd || null,
            args: launchArgs,
            command_line: [cmd, ...launchArgs].filter(Boolean).join(' ') || null,
        },
    };
}

module.exports = {
    getLlmAuthMode,
    resolveAgentAuthMode,
    getUserSecrets,
    applyGatewaySynthesis,
    resolveSpawnEnv,
    isAgentKeysReady,
    findMissing,
    previewGatewaySpawnEnv,
};
