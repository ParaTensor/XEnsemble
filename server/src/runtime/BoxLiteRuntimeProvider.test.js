const { test } = require('node:test');
const assert = require('node:assert/strict');

const BoxLiteRuntimeProvider = require('./BoxLiteRuntimeProvider');

class MockBoxLiteClient {
    constructor() {
        this.deleted = [];
        this.opened = [];
        this.execResults = [{ exitCode: 0, stdout: '', stderr: '' }];
    }

    async deleteSession(name) {
        this.deleted.push(name);
    }

    async openSession(name, image, warm = false) {
        this.opened.push({ name, image, warm });
        return { event: 'session_opened' };
    }

    async execForResult() {
        return this.execResults.shift() || { exitCode: 0, stdout: '', stderr: '' };
    }
}

test('ensureReady recreates blink session when stored image differs', async () => {
    const provider = new BoxLiteRuntimeProvider();
    const client = new MockBoxLiteClient();
    provider.client = client;

    const project = { id: 'proj_image_swap' };
    const result = await provider.ensureReady(project, {
        runtimeId: 'rt_swap',
        agentId: 'droid',
        storedImage: 'xensemble/box-base:bookworm',
    });

    assert.deepEqual(client.deleted, ['rt_swap']);
    assert.equal(client.opened.length, 1);
    assert.equal(client.opened[0].name, 'rt_swap');
    assert.match(client.opened[0].image, /agent-droid/);
    assert.equal(result.runtimeRef, 'rt_swap');
    assert.match(result.image, /agent-droid/);
});

test('ensureReady keeps existing session when image is unchanged', async () => {
    const provider = new BoxLiteRuntimeProvider();
    const client = new MockBoxLiteClient();
    provider.client = client;

    const image = 'xensemble/agent-claude-code:latest';
    const project = { id: 'proj_same_image' };
    await provider.ensureReady(project, {
        runtimeId: 'rt_same',
        agentId: 'claude-code',
        storedImage: image,
    });

    assert.deepEqual(client.deleted, []);
    assert.equal(client.opened[0].image, image);
});
