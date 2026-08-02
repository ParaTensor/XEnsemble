const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { eq } = require('drizzle-orm');
const { bootstrapTestDb } = require('../test/db');
const { reconcileRunningSessions } = require('./reconcileRunningSessions');

describe('reconcileRunningSessions', () => {
    let ctx;
    let db;
    let schema;

    before(async () => {
        ctx = await bootstrapTestDb(['../db/schema'], __dirname, { seed: false });
        ({ db, schema } = ctx);
    });

    after(async () => {
        if (ctx) await ctx.teardown();
    });

    beforeEach(async () => {
        await db.delete(schema.sessions);
        await db.insert(schema.users).values({
            id: 'u1',
            username: 'reconcile_test_user',
            passwordHash: 'hash',
            createdAt: Date.now(),
        }).onConflictDoNothing();
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

    it('demotes recoverable sessions with dead local pids to idle', async () => {
        await db.insert(schema.sessions).values({
            id: 'sess_recoverable_dead',
            userId: 'u1',
            agentId: 'kimi-code',
            cwd: '/tmp',
            status: 'running',
            streamRef: 'local:pty:1234567890123_a1b2c3d4_99999998',
            stateDirRef: '.xensemble/state/sess_recoverable_dead',
            recoverable: true,
            createdAt: Date.now(),
        });

        const result = await reconcileRunningSessions(db, schema, {
            processExists: () => false,
        });

        assert.equal(result.reconciled, 1);
        const rows = await db.select().from(schema.sessions)
            .where(eq(schema.sessions.id, 'sess_recoverable_dead'));
        assert.equal(rows[0].status, 'idle');
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

    it('skips boxlite sessions so boot recovery can reattach them', async () => {
        await db.insert(schema.sessions).values({
            id: 'sess_boxlite',
            userId: 'u1',
            agentId: 'claude-code',
            cwd: '/tmp',
            status: 'running',
            streamRef: 'boxlite:p_proj:exec_1',
            createdAt: Date.now(),
        });

        const result = await reconcileRunningSessions(db, schema, {
            processExists: () => false,
        });

        assert.equal(result.reconciled, 0);
        const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, 'sess_boxlite'));
        assert.equal(rows[0].status, 'running');
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
