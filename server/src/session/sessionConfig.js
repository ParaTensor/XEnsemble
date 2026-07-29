const { eq } = require('drizzle-orm');
const { DEFAULT_AGENTS } = require('../agents/defaultAgents');

/**
 * Get configSchema for an agent from the default catalog.
 */
function getAgentConfigSchema(agentId) {
    const agent = DEFAULT_AGENTS.find((a) => a.id === agentId);
    return agent?.configSchema || null;
}

/**
 * Resolve a config file path, replacing ${STATE_DIR} with the actual state dir.
 * Returns null if the path contains ${STATE_DIR} but no stateDirPath is provided.
 */
function resolveConfigFilePath(path, stateDirPath) {
    if (!path) return path;
    if (path.includes('${STATE_DIR}')) {
        if (!stateDirPath) return null;
        return path.replace(/\$\{STATE_DIR\}/g, stateDirPath);
    }
    return path;
}

/**
 * Validate that all config file paths are declared in the agent's configSchema.
 * Returns { valid, invalidPaths }.
 */
function validateConfigFiles(configFiles, agentId) {
    const schema = getAgentConfigSchema(agentId);
    if (!schema?.configFiles?.length) {
        return { valid: !configFiles?.length, invalidPaths: [] };
    }
    const allowedPaths = new Set(schema.configFiles.map((f) => f.path));
    const invalidPaths = [];
    for (const cf of configFiles || []) {
        if (!allowedPaths.has(cf.path)) {
            invalidPaths.push(cf.path);
        }
    }
    return { valid: invalidPaths.length === 0, invalidPaths };
}

/**
 * Write config files to the VM via the FS adapter.
 * Each file's path is resolved (replacing ${STATE_DIR}) and written via fsWrite.
 *
 * @param {object} fsAdapter - BoxLiteFsAdapter or LocalFsAdapter
 * @param {object} opts
 * @param {string} opts.workspaceRoot - workspace path in the VM
 * @param {string} opts.runtimeRef - blink session name
 * @param {Array} opts.configFiles - [{ path, content }]
 * @param {string|null} opts.stateDirPath - state directory path for ${STATE_DIR} resolution
 */
async function writeConfigFilesToVM(fsAdapter, { workspaceRoot, runtimeRef, configFiles, stateDirPath }) {
    if (!fsAdapter || typeof fsAdapter.fsWrite !== 'function') return;
    if (!configFiles?.length) return;
    for (const cf of configFiles) {
        if (!cf.path || !cf.content) continue;
        const resolvedPath = resolveConfigFilePath(cf.path, stateDirPath);
        if (!resolvedPath) continue;
        await fsAdapter.fsWrite(workspaceRoot, resolvedPath, cf.content, { runtimeRef });
    }
}

/**
 * Merge custom env into the resolved spawn env.
 * Custom env values are added on top of existing env (highest priority).
 */
function applyCustomEnv(env, customEnv) {
    if (!customEnv || typeof customEnv !== 'object') return env;
    const result = { ...env };
    for (const [key, raw] of Object.entries(customEnv)) {
        const trimmed = raw != null ? String(raw).trim() : '';
        if (trimmed) result[key] = trimmed;
        else delete result[key];
    }
    return result;
}

/**
 * Save session config to DB (upsert).
 */
async function saveSessionConfig(db, schema, sessionId, { configFiles, customEnv }) {
    const now = Date.now();
    const existing = await db.select().from(schema.sessionConfigs)
        .where(eq(schema.sessionConfigs.sessionId, sessionId));
    if (existing.length > 0) {
        await db.update(schema.sessionConfigs)
            .set({
                configFiles: configFiles || [],
                customEnv: customEnv || {},
                updatedAt: now,
            })
            .where(eq(schema.sessionConfigs.sessionId, sessionId));
    } else {
        await db.insert(schema.sessionConfigs)
            .values({
                sessionId,
                configFiles: configFiles || [],
                customEnv: customEnv || {},
                createdAt: now,
                updatedAt: now,
            });
    }
}

/**
 * Get session config from DB.
 * Returns { configFiles: [], customEnv: {} } if not found.
 */
async function getSessionConfig(db, schema, sessionId) {
    const rows = await db.select().from(schema.sessionConfigs)
        .where(eq(schema.sessionConfigs.sessionId, sessionId));
    if (rows.length === 0) {
        return { configFiles: [], customEnv: {} };
    }
    const row = rows[0];
    return {
        configFiles: row.configFiles || [],
        customEnv: row.customEnv || {},
    };
}

module.exports = {
    getAgentConfigSchema,
    resolveConfigFilePath,
    validateConfigFiles,
    writeConfigFilesToVM,
    applyCustomEnv,
    saveSessionConfig,
    getSessionConfig,
};
