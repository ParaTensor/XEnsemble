const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { eq } = require('drizzle-orm');
const { bootstrapTestDb } = require('../test/db');

const { TranscriptStore } = require('./TranscriptStore');

function makeTempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'xe-transcript-'));
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

test('TranscriptStore assigns monotonic seqs and supports cursor replay', () => {
    const root = makeTempRoot();
    try {
        const store = new TranscriptStore({ workspaceRoot: root, db: null, schema: null });
        const first = store.append('local:pty:123', { kind: 'out', data: 'hello' });
        const second = store.append('local:pty:123', { kind: 'in', data: 'ping' });
        const third = store.append('local:pty:123', { kind: 'resize', data: { cols: 80, rows: 24 } });

        assert.equal(first.seq, 1);
        assert.equal(second.seq, 2);
        assert.equal(third.seq, 3);
        assert.equal(store.head('local:pty:123'), 3);
        assert.equal(store.bytes('local:pty:123'), first.bytes + second.bytes + third.bytes);

        const replay = store.readFrom('local:pty:123', 1);
        assert.deepEqual(replay.map((frame) => frame.seq), [2, 3]);
        assert.equal(replay[0].kind, 'in');
        assert.equal(replay[1].kind, 'resize');
    } finally {
        cleanup(root);
    }
});

test('TranscriptStore resumes seqs from an existing transcript file', () => {
    const root = makeTempRoot();
    try {
        const firstStore = new TranscriptStore({ workspaceRoot: root, db: null, schema: null });
        firstStore.append('local:pty:restart', { kind: 'out', data: 'one\n' });
        firstStore.append('local:pty:restart', { kind: 'out', data: 'two\n' });
        firstStore.flushSync('local:pty:restart');

        const secondStore = new TranscriptStore({ workspaceRoot: root, db: null, schema: null });
        assert.equal(secondStore.head('local:pty:restart'), 2);
        const third = secondStore.append('local:pty:restart', { kind: 'out', data: 'three\n' });
        assert.equal(third.seq, 3);
        assert.deepEqual(secondStore.readFrom('local:pty:restart', 2).map((frame) => frame.seq), [3]);
    } finally {
        cleanup(root);
    }
});

test('TranscriptStore derives reattach cursor from the current execution only', () => {
    const root = makeTempRoot();
    try {
        const store = new TranscriptStore({ workspaceRoot: root, db: null, schema: null });
        store.append('boxlite:p_proj:exec_1', { kind: 'out', data: 'first-1', rseq: 1 });
        store.append('boxlite:p_proj:exec_1', { kind: 'out', data: 'first-2', rseq: 2 });
        store.append('boxlite:p_proj:exec_1', { kind: 'exit', data: { code: 0 } });
        store.append('boxlite:p_proj:exec_1', { kind: 'out', data: 'second-1', rseq: 7 });
        store.append('boxlite:p_proj:exec_1', { kind: 'in', data: 'ignored', rseq: 8 });
        store.append('boxlite:p_proj:exec_1', { kind: 'resize', data: { cols: 100, rows: 40 } });
        store.append('boxlite:p_proj:exec_1', { kind: 'out', data: 'second-2', rseq: 9 });

        assert.equal(store.reattachCursor('boxlite:p_proj:exec_1'), 9);
    } finally {
        cleanup(root);
    }
});

test('TranscriptStore updates session_streams metadata on bind and exit', async () => {
    const root = makeTempRoot();
    let ctx;
    try {
        ctx = await bootstrapTestDb(['../db/schema'], __dirname, { seed: false });
        const { db, schema } = ctx;

        await db.insert(schema.users).values({
            id: 'u1',
            username: 'transcript_test_user',
            passwordHash: 'hash',
            createdAt: Date.now(),
        }).onConflictDoNothing();
        await db.insert(schema.sessions).values({ id: 'sess_1', userId: 'u1', agentId: 'a1', cwd: '/tmp', createdAt: Date.now() });

        const store = new TranscriptStore({
            workspaceRoot: root,
            db,
            schema: { sessionStreams: schema.sessionStreams },
        });

        store.bindSession('sess_1', 'local:pty:meta');
        store.append('local:pty:meta', { kind: 'out', data: 'hello' });
        store.append('local:pty:meta', { kind: 'exit', data: { code: 0 } });

        await new Promise((resolve) => setTimeout(resolve, 50));

        const rows = await db.select().from(schema.sessionStreams).where(eq(schema.sessionStreams.sessionId, 'sess_1'));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].headSeq, 2);
        assert.equal(rows[0].storageRef, 'local:pty:meta');
        assert.equal(rows[0].bytes, 5 + Buffer.byteLength(JSON.stringify({ code: 0 })));
    } finally {
        if (ctx) await ctx.teardown();
        cleanup(root);
    }
});
