const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');

const schema = require('../db/schema');

function createTestDb() {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cmd TEXT NOT NULL,
        args TEXT NOT NULL,
        env_required TEXT NOT NULL
      );
      CREATE TABLE agent_box_images (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id),
        image_ref TEXT NOT NULL,
        tag TEXT NOT NULL,
        digest TEXT,
        status TEXT NOT NULL DEFAULT 'ready',
        is_active INTEGER DEFAULT 0,
        built_at INTEGER,
        notes TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(agent_id, tag)
      );
    `);
    sqlite.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES ('admin', 'admin', 'hash', 1)`).run();
    sqlite.prepare(`INSERT INTO agents (id, name, cmd, args, env_required) VALUES ('claude-code', 'Claude Code', 'claude', '[]', '[]')`).run();
    return drizzle(sqlite);
}

test('register, activate, and resolve active boxlite image from DB', async () => {
    const testDb = createTestDb();
    const dbModule = require('../db/index');
    const previousDb = dbModule.db;
    dbModule.db = testDb;

    delete require.cache[require.resolve('./AgentBoxImageService')];
    delete require.cache[require.resolve('./agentBoxImages')];
    const service = require('./AgentBoxImageService');
    const { resolveBoxImage } = require('./agentBoxImages');

    try {
        const first = await service.registerVersion({
            agentId: 'claude-code',
            tag: 'v1',
            imageRef: 'registry.example/agent-claude-code:v1',
            createdBy: 'admin',
            setActive: true,
        });
        assert.equal(first.is_active, true);

        const second = await service.registerVersion({
            agentId: 'claude-code',
            tag: 'v2',
            imageRef: 'registry.example/agent-claude-code:v2',
            createdBy: 'admin',
            setActive: false,
        });
        assert.equal(second.is_active, false);

        await service.activateVersion(second.id, 'admin');
        assert.equal(await service.getActiveImageRef('claude-code'), 'registry.example/agent-claude-code:v2');

        const resolved = await resolveBoxImage({ agentId: 'claude-code' });
        assert.equal(resolved, 'registry.example/agent-claude-code:v2');

        const catalog = await service.listAgentBoxImageCatalog();
        const entry = catalog.find((row) => row.agent_id === 'claude-code');
        assert.equal(entry.active_version.tag, 'v2');
        assert.equal(entry.versions.length, 2);
    } finally {
        dbModule.db = previousDb;
        delete require.cache[require.resolve('./AgentBoxImageService')];
        delete require.cache[require.resolve('./agentBoxImages')];
    }
});
