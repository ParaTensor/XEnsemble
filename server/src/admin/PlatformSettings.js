const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const { DEFAULT_QUOTA } = require('../auth/PolicyService');

const DEFAULTS = {
    llm_auth_mode: 'byok',
    registration_mode: 'open',
    default_user_quota: {
        max_projects: DEFAULT_QUOTA.maxProjects,
        max_sessions: DEFAULT_QUOTA.maxSessions,
        max_previews: DEFAULT_QUOTA.maxPreviews,
        max_runtimes: DEFAULT_QUOTA.maxRuntimes,
        resource_tier: DEFAULT_QUOTA.resourceTier,
    },
    session_ttl_hours: 24,
    default_terminal_theme_id: 'nord',
    disabled_terminal_theme_ids: [],
};

async function get(key) {
    const rows = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, key));
    if (rows.length === 0) return DEFAULTS[key] ?? null;
    try {
        return JSON.parse(rows[0].value);
    } catch {
        return rows[0].value;
    }
}

async function set(key, value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const existing = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, key));
    if (existing.length > 0) {
        await db.update(schema.platformSettings).set({ value: serialized }).where(eq(schema.platformSettings.key, key));
    } else {
        await db.insert(schema.platformSettings).values({ key, value: serialized });
    }
    return value;
}

async function getAll() {
    const rows = await db.select().from(schema.platformSettings);
    const out = { ...DEFAULTS };
    for (const row of rows) {
        try {
            out[row.key] = JSON.parse(row.value);
        } catch {
            out[row.key] = row.value;
        }
    }
    return out;
}

async function updateAll(updates) {
    const allowed = [
        'llm_auth_mode',
        'registration_mode',
        'default_user_quota',
        'session_ttl_hours',
        'default_terminal_theme_id',
        'disabled_terminal_theme_ids',
    ];
    if (updates.llm_auth_mode !== undefined && !['gateway', 'byok'].includes(updates.llm_auth_mode)) {
        throw Object.assign(new Error('Invalid llm_auth_mode'), { statusCode: 400 });
    }
    if (updates.disabled_terminal_theme_ids !== undefined) {
        if (!Array.isArray(updates.disabled_terminal_theme_ids)) {
            throw Object.assign(new Error('disabled_terminal_theme_ids must be an array'), { statusCode: 400 });
        }
    }
    for (const key of allowed) {
        if (updates[key] !== undefined) {
            await set(key, updates[key]);
        }
    }
    return getAll();
}

async function getRegistrationMode() {
    return (await get('registration_mode')) || 'open';
}

async function getDefaultUserQuota() {
    return (await get('default_user_quota')) || DEFAULTS.default_user_quota;
}

async function getLlmAuthMode() {
    const mode = await get('llm_auth_mode');
    return mode === 'gateway' ? 'gateway' : 'byok';
}

async function seedDefaults(sqlite) {
    const insert = sqlite.prepare('INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)');
    insert.run('llm_auth_mode', JSON.stringify(DEFAULTS.llm_auth_mode));
    insert.run('registration_mode', JSON.stringify(DEFAULTS.registration_mode));
    insert.run('default_user_quota', JSON.stringify(DEFAULTS.default_user_quota));
    insert.run('session_ttl_hours', JSON.stringify(DEFAULTS.session_ttl_hours));
    insert.run('default_terminal_theme_id', JSON.stringify(DEFAULTS.default_terminal_theme_id));
    insert.run('disabled_terminal_theme_ids', JSON.stringify(DEFAULTS.disabled_terminal_theme_ids));
}

module.exports = {
    DEFAULTS,
    get,
    set,
    getAll,
    updateAll,
    getLlmAuthMode,
    getRegistrationMode,
    getDefaultUserQuota,
    seedDefaults,
};
