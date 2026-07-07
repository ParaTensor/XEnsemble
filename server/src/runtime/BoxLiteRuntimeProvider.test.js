const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const BoxLiteRuntimeProvider = require('./BoxLiteRuntimeProvider');
const workspace = require('../workspace');
const agentBootstrap = require('../workspace/agentBootstrap');

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
        this.opened.push({
            name,
            image,
            warm,
            volumes: options.volumes || [],
            network: options.network || null,
        });
        return { event: 'session_opened' };
    }

    async execForResult() {
        return this.execResults.shift() || { exitCode: 0, stdout: '', stderr: '' };
    }
}

let originalEnsureBootstrap;

before(() => {
    originalEnsureBootstrap = agentBootstrap.ensureAgentBootstrap;
    agentBootstrap.ensureAgentBootstrap = async () => ({ status: 'skipped' });
});

after(() => {
    agentBootstrap.ensureAgentBootstrap = originalEnsureBootstrap;
});

test('ensureReady recreates blink session when stored image differs', async () => {
    const provider = new BoxLiteRuntimeProvider();
    const client = new MockBoxLiteClient();
    provider.client = client;

    const project = { id: 'proj_image_swap', userId: 'usr_swap' };
    const result = await provider.ensureReady(project, {
        runtimeId: 'rt_swap',
        agentId: 'droid',
        image: 'xensemble/agent-droid:latest',
        storedImage: 'xensemble/box-base:bookworm',
    });

    assert.deepEqual(client.deleted, ['rt_swap']);
    assert.equal(client.opened.length, 1);
    assert.equal(client.opened[0].name, 'rt_swap');
    assert.equal(client.opened[0].image, 'xensemble/agent-droid:latest');
    assert.equal(client.opened[0].volumes.length, 1);
    assert.match(client.opened[0].volumes[0].host_path, /usr_swap[/\\]proj_image_swap$/);
    assert.equal(client.opened[0].volumes[0].guest_path, '/workspace');
    assert.deepEqual(client.opened[0].network, { mode: 'enabled', allow_net: [] });
    assert.equal(result.runtimeRef, 'rt_swap');
    assert.equal(result.image, 'xensemble/agent-droid:latest');
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
        image,
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
    const guestPath = '/workspace';
    const hostPath = workspace.projectDir(project.userId, project.id);
    return `${hostPath}=>${guestPath}`;
}
