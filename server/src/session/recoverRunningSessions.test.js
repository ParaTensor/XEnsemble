const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eq } = require('drizzle-orm');

const schema = require('../db/schema');
const { db } = require('../db/index');
const sessionManager = require('./SessionManager');
const transcriptStore = require('../runtime/TranscriptStore');
const { recoverRunningSessions } = require('./recoverRunningSessions');

function uniqueId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeHandle(streamRef, frames = []) {
    const dataCbs = new Set();
    const exitCbs = new Set();
    return {
        streamRef,
        onData(cb) {
            dataCbs.add(cb);
            return { dispose: () => dataCbs.delete(cb) };
        },
        onExit(cb) {
            exitCbs.add(cb);
            return { dispose: () => exitCbs.delete(cb) };
        },
        write() {},
        resize() {},
        kill() {},
        get pid() { return null; },
        async getMetrics() { return { cpu: 0, memory: 0 }; },
        emitFrames() {
            for (const frame of frames) {
                for (const cb of [...dataCbs]) {
                    cb(frame.data, frame.rseq);
                }
            }
        },
        emitExit(exitCode = 0) {
            for (const cb of [...exitCbs]) {
                cb({ exitCode });
            }
        },
    };
}

test('recoverRunningSessions reattaches a live boxlite session and continues transcript seqs', async () => {
    const sessionId = uniqueId('sess');
    const userId = uniqueId('usr');
    const projectId = uniqueId('proj');
    const transcriptRef = `boxlite:p_${projectId}:exec_1`;
    try {
        await db.insert(schema.users).values({
            id: userId,
            username: uniqueId('recover_user'),
            passwordHash: 'hash',
            role: 'user',
            status: 'active',
            createdAt: Date.now(),
        });
        await db.insert(schema.projects).values({
            id: projectId,
            userId,
            name: 'Recover Project',
            serverPath: '/tmp',
            workspaceMode: 'local',
            createdAt: Date.now(),
        });
        await db.insert(schema.sessions).values({
            id: sessionId,
            userId,
            projectId,
            agentId: 'kimi-code',
            cwd: '/tmp',
            streamRef: transcriptRef,
            recoverable: true,
            status: 'running',
            createdAt: Date.now(),
        });
        await db.insert(schema.sessionStreams).values({
            sessionId,
            headSeq: 2,
            bytes: Buffer.byteLength('line-1\n') + Buffer.byteLength('line-2\n'),
            storageRef: transcriptRef,
            updatedAt: Date.now(),
        });

        transcriptStore.append(transcriptRef, { kind: 'out', data: 'line-1\n', rseq: 1 });
        transcriptStore.append(transcriptRef, { kind: 'out', data: 'line-2\n', rseq: 2 });

        const reattachHandle = makeHandle(transcriptRef, [
            { data: 'line-3\n', rseq: 3 },
            { data: 'line-4\n', rseq: 4 },
        ]);
        let observedAfter = null;
        const runtime = {
            provider: {
                async attachSession(attachSessionId, streamRef, options = {}) {
                    assert.equal(attachSessionId, sessionId);
                    assert.equal(streamRef, transcriptRef);
                    observedAfter = options.after;
                    return reattachHandle;
                },
            },
        };

        const result = await recoverRunningSessions({
            db,
            schema,
            runtime,
            sessionManager,
            transcriptStore,
            fastifyLog: { info() {}, warn() {}, error() {} },
        });

        assert.equal(result.recovered, 1);
        assert.equal(observedAfter, 2);

        reattachHandle.emitFrames();
        await new Promise((resolve) => setImmediate(resolve));

        const live = sessionManager.getSession(sessionId);
        assert.ok(live);
        assert.equal(sessionManager.isAlive(sessionId), true);
        assert.equal(live.transcriptRef, transcriptRef);

        const transcript = transcriptStore.readFrom(transcriptRef, 0);
        assert.deepEqual(transcript.map((frame) => frame.seq), [1, 2, 3, 4]);
        assert.deepEqual(transcript.filter((frame) => frame.kind === 'out').map((frame) => frame.rseq), [1, 2, 3, 4]);
        assert.equal(transcriptStore.reattachCursor(transcriptRef), 4);
    } finally {
        sessionManager.deleteSession(sessionId);
        await new Promise((resolve) => setImmediate(resolve));
        await db.delete(schema.sessionStreams).where(eq(schema.sessionStreams.sessionId, sessionId));
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
});

test('recoverRunningSessions marks a failed reattach as exited', async () => {
    const sessionId = uniqueId('sess');
    const userId = uniqueId('usr');
    const projectId = uniqueId('proj');
    const transcriptRef = `boxlite:p_${projectId}:exec_2`;
    try {
        await db.insert(schema.users).values({
            id: userId,
            username: uniqueId('recover_fail_user'),
            passwordHash: 'hash',
            role: 'user',
            status: 'active',
            createdAt: Date.now(),
        });
        await db.insert(schema.projects).values({
            id: projectId,
            userId,
            name: 'Recover Fail Project',
            serverPath: '/tmp',
            workspaceMode: 'local',
            createdAt: Date.now(),
        });
        await db.insert(schema.sessions).values({
            id: sessionId,
            userId,
            projectId,
            agentId: 'kimi-code',
            cwd: '/tmp',
            streamRef: transcriptRef,
            recoverable: true,
            status: 'running',
            createdAt: Date.now(),
        });
        await db.insert(schema.sessionStreams).values({
            sessionId,
            headSeq: 1,
            bytes: Buffer.byteLength('line-1\n'),
            storageRef: transcriptRef,
            updatedAt: Date.now(),
        });

        transcriptStore.append(transcriptRef, { kind: 'out', data: 'line-1\n', rseq: 1 });

        const runtime = {
            provider: {
                async attachSession() {
                    throw new Error('gone');
                },
            },
        };

        const result = await recoverRunningSessions({
            db,
            schema,
            runtime,
            sessionManager,
            transcriptStore,
            fastifyLog: { info() {}, warn() {}, error() {} },
        });

        assert.equal(result.recovered, 0);
        const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
        assert.equal(rows[0].status, 'exited');
    } finally {
        sessionManager.deleteSession(sessionId);
        await new Promise((resolve) => setImmediate(resolve));
        await db.delete(schema.sessionStreams).where(eq(schema.sessionStreams.sessionId, sessionId));
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
});
