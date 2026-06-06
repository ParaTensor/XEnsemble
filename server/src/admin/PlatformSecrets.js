const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const auth = require('../auth/index');

const PLATFORM_SECRETS_KEY = 'agent_secrets_encrypted';

async function getRaw() {
    const rows = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, PLATFORM_SECRETS_KEY));
    if (rows.length === 0) return {};
    return auth.decryptSecrets(rows[0].value);
}

async function getHints() {
    const secrets = await getRaw();
    const hints = {};
    for (const [key, value] of Object.entries(secrets)) {
        if (value != null && String(value).trim() !== '') hints[key] = true;
    }
    return hints;
}

async function merge(updates) {
    const current = await getRaw();
    const filtered = Object.fromEntries(
        Object.entries(updates || {}).filter(([, v]) => v != null && String(v).trim() !== ''),
    );
    const merged = { ...current, ...filtered };
    const encrypted = auth.encryptSecrets(merged);

    const existing = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.key, PLATFORM_SECRETS_KEY));
    if (existing.length > 0) {
        await db.update(schema.platformSettings).set({ value: encrypted }).where(eq(schema.platformSettings.key, PLATFORM_SECRETS_KEY));
    } else {
        await db.insert(schema.platformSettings).values({ key: PLATFORM_SECRETS_KEY, value: encrypted });
    }
    return merged;
}

module.exports = {
    getRaw,
    getHints,
    merge,
};
