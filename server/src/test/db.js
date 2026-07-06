const path = require('path');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { runMigrations } = require('../db/migrate');
const { seedIfNeeded } = require('../db/seed');
const schema = require('../db/schema');
const { resetConnection, closeConnection } = require('../db/index');

function adminUrlFrom(baseUrl) {
    const parsed = new URL(baseUrl);
    parsed.pathname = '/postgres';
    return parsed.toString();
}

function databaseUrlWithName(baseUrl, dbName) {
    const parsed = new URL(baseUrl);
    parsed.pathname = `/${dbName}`;
    return parsed.toString();
}

function randomDbName() {
    const workerId = process.env.TEST_WORKER_ID || '0';
    const suffix = Math.random().toString(36).slice(2, 10);
    return `xensemble_test_${process.pid}_${workerId}_${suffix}`;
}

const TEMPLATE_DB_NAME = 'xensemble_test_template';
let templateReady = false;

async function ensureTemplateDatabase(baseUrl) {
    if (templateReady) return;
    const admin = postgres(adminUrlFrom(baseUrl), { max: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS "${TEMPLATE_DB_NAME}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${TEMPLATE_DB_NAME}"`);
    await admin.end({ timeout: 0 });

    const templateUrl = databaseUrlWithName(baseUrl, TEMPLATE_DB_NAME);
    const { db } = await resetConnection(templateUrl);
    await runMigrations(db);
    await seedIfNeeded(db);
    await closeConnection();
    templateReady = true;
}

/**
 * 为单个测试文件创建隔离 PostgreSQL 库，migrate + seed 后注入 db/index 单例。
 */
async function setupTestDb(options = {}) {
    const baseUrl = options.databaseUrl
        || process.env.TEST_DATABASE_URL
        || process.env.DATABASE_URL;
    if (!baseUrl) {
        throw new Error('DATABASE_URL (or TEST_DATABASE_URL) is required for tests');
    }

    await ensureTemplateDatabase(baseUrl);

    const dbName = options.dbName || randomDbName();
    const admin = postgres(adminUrlFrom(baseUrl), { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB_NAME}"`);
    await admin.end({ timeout: 5 });

    const testUrl = databaseUrlWithName(baseUrl, dbName);
    const { db, client } = await resetConnection(testUrl);

    async function cleanup() {
        await client.end({ timeout: 0 });
        const dropAdmin = postgres(adminUrlFrom(baseUrl), { max: 1 });
        await dropAdmin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
        await dropAdmin.end({ timeout: 0 });
        await closeConnection();
    }

    return { db, client, schema, cleanup, databaseUrl: testUrl, dbName };
}

/**
 * 将 db/index 模块导出替换为测试库连接（供 mock 子模块用）。
 */
function patchDbIndexExports(testDb) {
    const dbIndexPath = require.resolve('../db/index');
    const previousCache = require.cache[dbIndexPath];
    require.cache[dbIndexPath] = {
        id: dbIndexPath,
        filename: dbIndexPath,
        loaded: true,
        exports: {
            db: testDb,
            schema,
            get client() { return null; },
            resolveDatabaseUrl: () => { throw new Error('not available in patched test db'); },
            createClient: () => { throw new Error('not available in patched test db'); },
            resetConnection: () => { throw new Error('not available in patched test db'); },
            closeConnection: async () => {},
        },
    };
    return () => {
        if (previousCache) {
            require.cache[dbIndexPath] = previousCache;
        } else {
            delete require.cache[dbIndexPath];
        }
    };
}

function clearSrcModuleCache() {
    const srcRoot = path.join(__dirname, '..');
    for (const key of Object.keys(require.cache)) {
        if (key.startsWith(srcRoot) && !key.includes(`${path.sep}test${path.sep}`)) {
            delete require.cache[key];
        }
    }
}

/**
 * 安装测试库并在清除模块缓存后重新加载依赖 db 的模块。
 * @param {string[]} modulePaths require.resolve 可用的模块路径
 */
async function bootstrapTestDb(modulePaths = [], callerDir = path.join(__dirname, '..'), options = {}) {
    const ctx = await setupTestDb(options);
    clearSrcModuleCache();
    const restoreDbIndex = patchDbIndexExports(ctx.db);

    const reloaded = {};
    for (const modulePath of modulePaths) {
        const resolved = require.resolve(modulePath, { paths: [callerDir] });
        delete require.cache[resolved];
        reloaded[modulePath] = require(resolved);
    }
    return {
        ...ctx,
        restoreDbIndex,
        reloaded,
        async teardown() {
            clearSrcModuleCache();
            restoreDbIndex();
            await ctx.cleanup();
            clearSrcModuleCache();
        },
    };
}

module.exports = {
    setupTestDb,
    patchDbIndexExports,
    bootstrapTestDb,
    MIGRATIONS_FOLDER: path.join(__dirname, '../../drizzle'),
};
