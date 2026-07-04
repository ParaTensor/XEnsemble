const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eq } = require('drizzle-orm');

const { db } = require('../db/index');
const schema = require('../db/schema');
const transcriptStore = require('../runtime/TranscriptStore');
const sessionManager = require('./SessionManager');
const { subscribeTerminal } = require('./terminalBridge');

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

    emitData(data) {
        for (const cb of [...this.dataListeners]) {
            cb(data);
        }
    }

    emitExit(exitCode = 0, signal = null) {
        for (const cb of [...this.exitListeners]) {
            cb({ exitCode, signal });
        }
    }
}

test('subscribeTerminal replays from cursor and continues live without duplicates', async () => {
    const sessionId = `sess_bridge_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const streamRef = `local:pty:${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const userId = `usr_bridge_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const handle = new FakeHandle(streamRef);
    const payloads = [];
    try {
        await db.insert(schema.users).values({
            id: userId,
            username: `bridge_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            passwordHash: 'hash',
            role: 'user',
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        await db.insert(schema.sessions).values({
            id: sessionId,
            userId,
            agentId: 'kimi-code',
            cwd: '/tmp',
            status: 'running',
            streamRef,
            createdAt: Date.now(),
        });

        sessionManager.createSession(sessionId, handle, 'kimi-code');
        handle.emitData('line-1\n');
        handle.emitData('line-2\n');

        const sub = subscribeTerminal(sessionId, (payload) => {
            payloads.push(payload);
        }, { after: 1 });
        assert.equal(sub.ok, true);
        await new Promise((resolve) => setImmediate(resolve));

        const replayOutputs = payloads.filter((p) => p.type === 'output');
        assert.deepEqual(replayOutputs.map((p) => p.seq), [2]);
        assert.equal(replayOutputs[0].data, 'line-2\n');

        handle.emitData('line-3\n');
        await new Promise((resolve) => setImmediate(resolve));

        const outputsAfterLive = payloads.filter((p) => p.type === 'output');
        assert.deepEqual(outputsAfterLive.map((p) => p.seq), [2, 3]);
        assert.equal(outputsAfterLive[1].data, 'line-3\n');

        handle.emitExit(0);
        await new Promise((resolve) => setImmediate(resolve));

        const exit = payloads.find((p) => p.type === 'exit');
        assert.ok(exit);
        assert.equal(exit.data, 0);
        assert.equal(exit.seq, 4);

        const streamRows = await db.select().from(schema.sessionStreams).where(eq(schema.sessionStreams.sessionId, sessionId));
        assert.equal(streamRows.length, 1);
        assert.equal(streamRows[0].headSeq, 4);

        sub.cleanup();
    } finally {
        sessionManager.deleteSession(sessionId);
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
});

test('subscribeTerminal replay skips input and resize frames while advancing cursor', async () => {
    const sessionId = `sess_bridge_replay_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const streamRef = `local:pty:${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const userId = `usr_bridge_replay_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const handle = new FakeHandle(streamRef);
    const payloads = [];
    try {
        await db.insert(schema.users).values({
            id: userId,
            username: `bridge_replay_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            passwordHash: 'hash',
            role: 'user',
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
        await db.insert(schema.sessions).values({
            id: sessionId,
            userId,
            agentId: 'kimi-code',
            cwd: '/tmp',
            status: 'running',
            streamRef,
            createdAt: Date.now(),
        });

        sessionManager.createSession(sessionId, handle, 'kimi-code');
        handle.emitData('out-1\n');
        transcriptStore.append(streamRef, { kind: 'in', data: 'typed-1\n' });
        transcriptStore.append(streamRef, { kind: 'resize', data: { cols: 120, rows: 40 } });
        handle.emitData('out-2\n');

        const sub = subscribeTerminal(sessionId, (payload) => {
            payloads.push(payload);
        }, { after: 0 });
        assert.equal(sub.ok, true);
        await new Promise((resolve) => setImmediate(resolve));

        const outputs = payloads.filter((p) => p.type === 'output');
        assert.deepEqual(outputs.map((p) => p.data), ['out-1\n', 'out-2\n']);
        assert.deepEqual(outputs.map((p) => p.seq), [1, 4]);
        assert.ok(outputs.every((p) => typeof p.data !== 'object'));
        assert.equal(payloads.some((p) => p.type === 'output' && p.data?.cols), false);

        handle.emitExit(0);
        await new Promise((resolve) => setImmediate(resolve));
        sub.cleanup();
    } finally {
        sessionManager.deleteSession(sessionId);
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
});
