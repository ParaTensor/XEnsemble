const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { bootstrapTestDb } = require('../test/db');

class MockBoxLiteClient {
    constructor() {
        this.deleted = [];
        this.opened = [];
        this.execResults = [{ exitCode: 0, stdout: '', stderr: '' }];
    }

    async deleteSession(name) {
        this.deleted.push(name);
    }

    async openSession(name, image, warm = false, options = {}) {
        this.opened.push({ name, image, warm, volumes: options.volumes || [] });
        return { event: 'session_opened' };
    }

    async execForResult() {
        return this.execResults.shift() || { exitCode: 0, stdout: '', stderr: '' };
    }
}

let ctx;
let BoxLiteRuntimeProvider;

before(async () => {
    ctx = await bootstrapTestDb([
        './BoxLiteRuntimeProvider',
        '../workspace/agentBootstrap',
    ], __dirname);
    BoxLiteRuntimeProvider = ctx.reloaded['./BoxLiteRuntimeProvider'];

    const now = Date.now();
    const { schema } = ctx;
    const rows = [
        { userId: 'usr_swap', projectId: 'proj_image_swap' },
        { userId: 'usr_same', projectId: 'proj_same_image' },
        { userId: 'usr_mount', projectId: 'proj_mount' },
    ];
    for (const row of rows) {
        await ctx.db.insert(schema.users).values({
            id: row.userId,
            username: row.userId,
            passwordHash: 'hash',
            role: 'admin',
            status: 'active',
            createdAt: now,
        }).onConflictDoNothing();
        await ctx.db.insert(schema.projects).values({
            id: row.projectId,
            userId: row.userId,
            name: row.projectId,
            serverPath: '',
            createdAt: now,
        }).onConflictDoNothing();
    }
});

after(async () => {
    if (ctx) await ctx.teardown();
});

test('ensureReady recreates blink session when stored image differs', async () => {
    const provider = new BoxLiteRuntimeProvider();
    const client = new MockBoxLiteClient();
    provider.client = client;

    const project = { id: 'proj_image_swap', userId: 'usr_swap' };
    const result = await provider.ensureReady(project, {
        runtimeId: 'rt_swap',
        agentId: 'droid',
        storedImage: 'xensemble/box-base:bookworm',
    });

    assert.deepEqual(client.deleted, ['rt_swap']);
    assert.equal(client.opened.length, 1);
    assert.equal(client.opened[0].name, 'rt_swap');
    assert.match(client.opened[0].image, /agent-droid/);
    assert.equal(client.opened[0].volumes.length, 1);
    assert.match(client.opened[0].volumes[0].host_path, /usr_swap[/\\]proj_image_swap$/);
    assert.equal(client.opened[0].volumes[0].guest_path, '/workspace');
    assert.equal(result.runtimeRef, 'rt_swap');
    assert.match(result.image, /agent-droid/);
    assert.match(result.mountKey, /=>[/\\]workspace$/);
});

test('ensureReady keeps existing session when image is unchanged', async () => {
    const provider = new BoxLiteRuntimeProvider();
    const client = new MockBoxLiteClient();
    provider.client = client;

    const image = 'xensemble/agent-claude-code:latest';
    const project = { id: 'proj_same_image', userId: 'usr_same' };
    await provider.ensureReady(project, {
        runtimeId: 'rt_same',
        agentId: 'claude-code',
        storedImage: image,
        storedMount: resultMountKey(project),
    });

    assert.deepEqual(client.deleted, []);
    assert.equal(client.opened[0].image, image);
});

test('ensureReady recreates blink session when workspace mount differs', async () => {
    const provider = new BoxLiteRuntimeProvider();
    const client = new MockBoxLiteClient();
    provider.client = client;

    const project = { id: 'proj_mount', userId: 'usr_mount' };
    await provider.ensureReady(project, {
        runtimeId: 'rt_mount',
        storedMount: '/old/host=>/workspace',
    });

    assert.deepEqual(client.deleted, ['rt_mount']);
    assert.equal(client.opened.length, 1);
    assert.match(client.opened[0].volumes[0].host_path, /usr_mount[/\\]proj_mount$/);
});

function resultMountKey(project) {
    const provider = new BoxLiteRuntimeProvider();
    return provider.buildWorkspaceVolume(project).mountKey;
}
