const { test } = require('node:test');
const assert = require('node:assert/strict');

const { eq } = require('drizzle-orm');

const { db } = require('../db/index');
const schema = require('../db/schema');
const sessionManager = require('./SessionManager');
const { shouldHibernateSession, hibernateSession } = require('./idleHibernate');

class FakeHandle {
    constructor(streamRef) {
        this.streamRef = streamRef;
        this.dataListeners = new Set();
        this.exitListeners = new Set();
    }

    onData(cb) {
        this.dataListeners.add(cb);
        return { dispose: () => this.dataListeners.delete(cb) };
    }

    onExit(cb) {
        this.exitListeners.add(cb);
        return () => this.exitListeners.delete(cb);
    }

    write() {}
    resize() {}
    kill() {}
    async getMetrics() { return { cpu: 0, memory: 0 }; }
}

test('shouldHibernateSession respects threshold, subscribers, recent output, and provider capability', () => {
    const now = 10_000;
    const base = {
        id: 'sess_idle_case',
        status: 'running',
        handle: { streamRef: 'stream-1' },
        createdAt: 1_000,
        lastActivityAt: 1_000,
        activeTerminalSubscribers: 0,
    };

    assert.equal(shouldHibernateSession(base, now, 5_000, true), true);
    assert.equal(shouldHibernateSession({ ...base, lastActivityAt: 8_000 }, now, 5_000, true), false);
    assert.equal(shouldHibernateSession({ ...base, activeTerminalSubscribers: 1 }, now, 5_000, true), false);
    assert.equal(shouldHibernateSession({ ...base, lastOutputAt: 9_500, lastActivityAt: 9_500 }, now, 5_000, true), false);
    assert.equal(shouldHibernateSession({ ...base, handle: null }, now, 5_000, true), false);
    assert.equal(shouldHibernateSession(base, now, 5_000, false), false);
});

test('hibernateSession stops runtime and leaves the session idle without exiting', async () => {
    const sessionId = `sess_idle_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const userId = `usr_idle_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const projectId = `proj_idle_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const runtimeId = `rt_idle_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const streamRef = `stream_idle_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const cwd = '/tmp';
    const now = Date.now();
    const runtimeStops = [];
    const handle = new FakeHandle(streamRef);

    try {
        await db.insert(schema.users).values({
            id: userId,
            username: `idle_${now}`,
            passwordHash: 'hash',
            role: 'user',
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        await db.insert(schema.projects).values({
            id: projectId,
            userId,
            name: 'Idle Project',
            serverPath: cwd,
            workspaceMode: 'local',
            createdAt: now,
        });
        await db.insert(schema.runtimes).values({
            id: runtimeId,
            projectId,
            provider: 'local',
            runtimeRef: 'runtime_ref_1',
            role: 'default',
            status: 'ready',
            createdAt: now,
            updatedAt: now,
        });
        await db.insert(schema.sessions).values({
            id: sessionId,
            userId,
            projectId,
            agentId: 'claude-code',
            cwd,
            streamRef,
            stateDirRef: '.xensemble/state/sess_idle',
            recoverable: true,
            status: 'running',
            runtimeId,
            createdAt: now,
        });

        sessionManager.createSession(sessionId, handle, 'claude-code', {
            projectId,
            runtimeId: 'runtime_1',
            runtimeRef: 'runtime_ref_1',
            stateDirRef: '.xensemble/state/sess_idle',
            transcriptRef: streamRef,
            userId,
        });
        handle.dataListeners.forEach((cb) => cb('hello\n'));

        const session = sessionManager.getSession(sessionId);
        const runtime = {
            provider: {
                supportsHibernate() {
                    return true;
                },
                async hibernate(runtimeRef) {
                    runtimeStops.push(runtimeRef);
                },
            },
        };

        const result = await hibernateSession({
            db,
            schema,
            runtime,
            sessionManager,
            session,
            fastifyLog: { warn() {} },
        });

        assert.deepEqual(result, { hibernated: true });
        assert.deepEqual(runtimeStops, ['runtime_ref_1']);

        const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
        assert.equal(rows[0].status, 'idle');
        assert.equal(rows[0].recoverable, true);
        assert.equal(rows[0].streamRef, streamRef);
        assert.equal(rows[0].stateDirRef, '.xensemble/state/sess_idle');

        const live = sessionManager.getSession(sessionId);
        assert.equal(live.status, 'idle');
        assert.equal(live.handle, null);
        assert.equal(live.exitCode, null);
        assert.equal(live.hibernating, true);
        assert.equal(live.activeTerminalSubscribers, 0);
    } finally {
        sessionManager.deleteSession(sessionId);
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.runtimes).where(eq(schema.runtimes.id, runtimeId));
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
});
