const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { sqliteTable, text, integer } = require('drizzle-orm/sqlite-core');
const { eq } = require('drizzle-orm');

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

        const secondStore = new TranscriptStore({ workspaceRoot: root, db: null, schema: null });
        assert.equal(secondStore.head('local:pty:restart'), 2);
        const third = secondStore.append('local:pty:restart', { kind: 'out', data: 'three\n' });
        assert.equal(third.seq, 3);
        assert.deepEqual(secondStore.readFrom('local:pty:restart', 2).map((frame) => frame.seq), [3]);
    } finally {
        cleanup(root);
    }
});

test('TranscriptStore updates session_streams metadata on bind and exit', async () => {
    const root = makeTempRoot();
    const sqlite = new Database(':memory:');
    try {
        sqlite.exec(`
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY
            );
            CREATE TABLE session_streams (
                session_id TEXT PRIMARY KEY,
                head_seq INTEGER NOT NULL DEFAULT 0,
                bytes INTEGER NOT NULL DEFAULT 0,
                storage_ref TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);
        const db = drizzle(sqlite);
        const sessionStreams = sqliteTable('session_streams', {
            sessionId: text('session_id').primaryKey(),
            headSeq: integer('head_seq').notNull().default(0),
            bytes: integer('bytes').notNull().default(0),
            storageRef: text('storage_ref').notNull(),
            updatedAt: integer('updated_at').notNull(),
        });

        const store = new TranscriptStore({
            workspaceRoot: root,
            db,
            schema: { sessionStreams },
        });

        store.bindSession('sess_1', 'local:pty:meta');
        store.append('local:pty:meta', { kind: 'out', data: 'hello' });
        store.append('local:pty:meta', { kind: 'exit', data: { code: 0 } });

        const rows = await db.select().from(sessionStreams).where(eq(sessionStreams.sessionId, 'sess_1'));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].headSeq, 2);
        assert.equal(rows[0].storageRef, 'local:pty:meta');
        assert.equal(rows[0].bytes, 5 + Buffer.byteLength(JSON.stringify({ code: 0 })));
    } finally {
        sqlite.close();
        cleanup(root);
    }
});
