const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const DEFAULT_AUTH_MODE = 'byok';

const CONFIG_KEY = 'agent_gateway_config';

async function getAll() {
    const rows = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, CONFIG_KEY));
    if (rows.length === 0) return {};
    try {
        return JSON.parse(rows[0].value);
    } catch {
        return {};
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

async function setForAgent(agentId, { llm_auth_mode, provider, model } = {}) {
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
    return all[agentId] || null;
}

module.exports = {
    getAll,
    getForAgent,
    getAgentAuthMode,
    setForAgent,
};
