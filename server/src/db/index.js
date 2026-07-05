const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const schema = require('./schema');

function resolveDatabaseUrl() {
    const url = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
    if (!url) {
        throw new Error(
            'DATABASE_URL is required. Example: postgres://xensemble:xensemble@127.0.0.1:5432/xensemble',
        );
    }
    return url;
}

function createClient(url = resolveDatabaseUrl()) {
    return postgres(url, {
        max: Number(process.env.DATABASE_POOL_MAX || 10),
        ssl: process.env.DATABASE_SSL === 'true' ? 'require' : undefined,
    });
}

let client = createClient();
let db = drizzle(client, { schema });

/**
 * 测试 harness 用：切换到独立库连接。
 * @param {string} url
 */
async function resetConnection(url) {
    if (client) {
        await client.end({ timeout: 0 });
        client = null;
        db = null;
    }
    client = createClient(url);
    db = drizzle(client, { schema });
    return { db, client };
}

async function closeConnection() {
    if (client) {
        await client.end({ timeout: 0 });
        client = null;
        db = null;
    }
}

module.exports = {
    get db() { return db; },
    get client() { return client; },
    schema,
    resolveDatabaseUrl,
    createClient,
    resetConnection,
    closeConnection,
};
