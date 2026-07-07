const agentGatewayConfig = require('../admin/AgentGatewayConfig');
const { db } = require('../db/index');
const schema = require('../db/schema');
const auth = require('../auth/index');
const { eq } = require('drizzle-orm');
const {
    DEFAULT_KIMI_BASE_URL,
    DEFAULT_KIMI_MODEL,
    buildKimiConfigToml,
    shellWriteConfigScript,
} = require('./kimiConfigToml');

const KIMI_CODE_AGENT_ID = 'kimi-code';

async function getUserKimiSecrets(userId) {
    const rows = await db.select().from(schema.secrets).where(eq(schema.secrets.userId, userId));
    if (rows.length === 0) return {};
    return auth.decryptSecrets(rows[0].encryptedData);
}

/**
 * Write ~/.kimi/config.toml inside the sandbox when the user supplied a Kimi API key (BYOK).
 * Kimi Code reads credentials only from config.toml, not shell env.
 */
async function ensureKimiConfig({ runtime, runtimeRef, userId, agentId, warn }) {
    if (agentId !== KIMI_CODE_AGENT_ID) {
        return { skipped: true, reason: 'not_kimi_code' };
    }
    if (!runtimeRef || !runtime?.exec?.exec) {
        return { skipped: true, reason: 'no_runtime_exec' };
    }

    const authMode = await agentGatewayConfig.getAgentAuthMode(agentId);
    if (authMode !== 'byok') {
        return { skipped: true, reason: 'not_byok' };
    }

    const secrets = await getUserKimiSecrets(userId);
    const apiKey = secrets.KIMI_API_KEY?.trim() || secrets.MOONSHOT_API_KEY?.trim() || '';
    if (!apiKey) {
        return { skipped: true, reason: 'no_kimi_api_key' };
    }

    const baseUrl = secrets.KIMI_BASE_URL?.trim()
        || secrets.MOONSHOT_BASE_URL?.trim()
        || DEFAULT_KIMI_BASE_URL;
    const model = secrets.KIMI_MODEL?.trim()
        || secrets.MOONSHOT_MODEL?.trim()
        || DEFAULT_KIMI_MODEL;

    const configToml = buildKimiConfigToml({ apiKey, baseUrl, model });
    const script = shellWriteConfigScript(configToml);

    try {
        const result = await runtime.exec.exec(
            'sh',
            ['-lc', script],
            {},
            { runtimeRef, cwd: '/' },
        );
        if (result.exitCode !== 0) {
            const message = `kimi config bootstrap failed with exit ${result.exitCode}`;
            warn?.(message);
            return { skipped: false, ok: false, error: message };
        }
        return { skipped: false, ok: true };
    } catch (err) {
        const message = err?.message || 'kimi config bootstrap failed';
        warn?.(message);
        return { skipped: false, ok: false, error: message };
    }
}

module.exports = {
    KIMI_CODE_AGENT_ID,
    ensureKimiConfig,
};
