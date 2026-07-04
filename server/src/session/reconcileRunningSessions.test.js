const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { eq } = require('drizzle-orm');
const schema = require('../db/schema');
const { reconcileRunningSessions } = require('./reconcileRunningSessions');

describe('reconcileRunningSessions', () => {
    let sqlite;
    let db;

    beforeEach(() => {
        sqlite = new Database(':memory:');
        sqlite.exec(`
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                project_id TEXT,
                runtime_id TEXT,
                agent_id TEXT NOT NULL,
                cwd TEXT NOT NULL,
                stream_ref TEXT,
                state_dir_ref TEXT,
                recoverable INTEGER DEFAULT 0,
                status TEXT DEFAULT 'running',
                title TEXT,
                created_at INTEGER NOT NULL
            );
        `);
        db = drizzle(sqlite);
    });

    it('marks running sessions with dead local pids as exited', async () => {
        await db.insert(schema.sessions).values({
            id: 'sess_dead',
            userId: 'u1',
            agentId: 'kimi-code',
            cwd: '/tmp',
            status: 'running',
            streamRef: 'local:pty:1234567890123_a1b2c3d4_99999999',
            createdAt: Date.now(),
        });

        const result = await reconcileRunningSessions(db, schema, {
            processExists: () => false,
        });

        assert.equal(result.reconciled, 1);
        const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, 'sess_dead'));
        assert.equal(rows[0].status, 'exited');
    });

    it('keeps running sessions with alive local pids as running', async () => {
        await db.insert(schema.sessions).values({
            id: 'sess_alive',
            userId: 'u1',
            agentId: 'kimi-code',
            cwd: '/tmp',
            status: 'running',
            streamRef: 'local:pty:1234567890123_a1b2c3d4_1',
            createdAt: Date.now(),
        });

        const result = await reconcileRunningSessions(db, schema, {
            processExists: () => true,
        });

        assert.equal(result.reconciled, 0);
        const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, 'sess_alive'));
        assert.equal(rows[0].status, 'running');
    });

    it('marks running sessions without a stream_ref as exited', async () => {
        await db.insert(schema.sessions).values({
            id: 'sess_no_ref',
            userId: 'u1',
            agentId: 'kimi-code',
            cwd: '/tmp',
            status: 'running',
            streamRef: null,
            createdAt: Date.now(),
        });

        const result = await reconcileRunningSessions(db, schema, {
            processExists: () => true,
        });

        assert.equal(result.reconciled, 1);
        const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, 'sess_no_ref'));
        assert.equal(rows[0].status, 'exited');
    });

    it('does not touch already-exited sessions', async () => {
        await db.insert(schema.sessions).values({
            id: 'sess_exited',
            userId: 'u1',
            agentId: 'kimi-code',
            cwd: '/tmp',
            status: 'exited',
            streamRef: 'local:pty:1234567890123_a1b2c3d4_99999999',
            createdAt: Date.now(),
        });

        const result = await reconcileRunningSessions(db, schema, {
            processExists: () => false,
        });

        assert.equal(result.reconciled, 0);
        const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, 'sess_exited'));
        assert.equal(rows[0].status, 'exited');
    });
});
