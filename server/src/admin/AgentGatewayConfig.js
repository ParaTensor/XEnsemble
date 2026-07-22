const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const DEFAULT_AUTH_MODE = 'byok';

const CONFIG_KEY = 'agent_gateway_config';

const CACHE_TTL_MS = Number(process.env.AGENT_GATEWAY_CACHE_TTL_MS) || 5000;

let _cache = null;
let _cacheAt = 0;

async function getAll() {
    const now = Date.now();
    if (_cache && (now - _cacheAt) < CACHE_TTL_MS) return _cache;
    const rows = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, CONFIG_KEY));
    if (rows.length === 0) {
        _cache = {};
        _cacheAt = now;
        return _cache;
    }
    try {
        _cache = JSON.parse(rows[0].value);
        _cacheAt = now;
        return _cache;
    } catch {
        _cache = {};
        _cacheAt = now;
        return _cache;
    }
}

async function getForAgent(agentId) {
    const all = await getAll();
    return all[agentId] || null;
}

async function getAgentAuthMode(agentId) {
    const cfg = await getForAgent(agentId);
    if (cfg?.llm_auth_mode === 'gateway' || cfg?.llm_auth_mode === 'byok') {
        return cfg.llm_auth_mode;
    }
    return DEFAULT_AUTH_MODE;
}

async function setForAgent(agentId, { llm_auth_mode, provider, model, env_overrides } = {}) {
    const all = await getAll();
    const next = { ...(all[agentId] || {}) };

    if (llm_auth_mode === 'gateway' || llm_auth_mode === 'byok') {
        next.llm_auth_mode = llm_auth_mode;
    }

    if (provider !== undefined) {
        const trimmed = provider != null ? String(provider).trim() : '';
        if (trimmed) next.provider = trimmed;
        else delete next.provider;
    }

    if (model !== undefined) {
        const trimmed = model != null ? String(model).trim() : '';
        if (trimmed) next.model = trimmed;
        else delete next.model;
    }

    if (env_overrides !== undefined) {
        const cleaned = {};
        if (env_overrides && typeof env_overrides === 'object') {
            for (const [key, raw] of Object.entries(env_overrides)) {
                const trimmed = raw != null ? String(raw).trim() : '';
                if (trimmed) cleaned[key] = trimmed;
            }
        }
        if (Object.keys(cleaned).length > 0) next.env_overrides = cleaned;
        else delete next.env_overrides;
    }

    if (Object.keys(next).length === 0) {
        delete all[agentId];
    } else {
        all[agentId] = next;
    }

    const value = JSON.stringify(all);
    const existing = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, CONFIG_KEY));
    if (existing.length > 0) {
        await db.update(schema.platformSettings).set({ value }).where(eq(schema.platformSettings.key, CONFIG_KEY));
    } else {
        await db.insert(schema.platformSettings).values({ key: CONFIG_KEY, value });
    }
    _cache = null;

    const saved = all[agentId] || null;
    let sync = null;
    if (saved?.llm_auth_mode === 'gateway' && saved.provider) {
        // Required lazily to avoid a load-time cycle with agentServiceSync,
        // which requires this module back.
        const { syncAgentServiceBinding } = require('../llm/agentServiceSync');
        try {
            sync = await syncAgentServiceBinding(agentId);
        } catch (err) {
            sync = { synced: false, reason: 'sync_failed', error: err.message };
        }
    }
    return { config: saved, sync };
}

module.exports = {
    getAll,
    getForAgent,
    getAgentAuthMode,
    setForAgent,
};
