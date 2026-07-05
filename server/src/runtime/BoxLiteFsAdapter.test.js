const { test } = require('node:test');
const assert = require('node:assert/strict');

const BoxLiteFsAdapter = require('./BoxLiteFsAdapter');

class MockBoxLiteClient {
    constructor() {
        this.paths = new Set();
        this.calls = [];
    }

    async execForResult(sessionName, command, args = [], env = {}, workingDir = null) {
        this.calls.push({ sessionName, command, args, workingDir });
        if (command === 'test' && args[0] === '-e') {
            return { exitCode: this.paths.has(args[1]) ? 0 : 1, stdout: '', stderr: '' };
        }
        if (command === 'mkdir') {
            this.paths.add(args[1]);
            return { exitCode: 0, stdout: '', stderr: '' };
        }
        return { exitCode: 1, stdout: '', stderr: '' };
    }
}

test('BoxLite resolveStateDir uses in-box workspace paths', () => {
    const adapter = new BoxLiteFsAdapter();
    const resolved = adapter.resolveStateDir('/workspace', 'sess_box');
    assert.match(resolved.stateDirRef, /\.xensemble[/\\]state[/\\]sess_box$/);
    assert.equal(resolved.stateDirPath, '/workspace/.xensemble/state/sess_box');
});

test('BoxLite exists and mkdirp operate through blink exec', async () => {
    const adapter = new BoxLiteFsAdapter();
    const client = new MockBoxLiteClient();
    adapter.client = client;
    const sessionId = 'sess_box';
    const resolved = adapter.resolveStateDir('/workspace', sessionId);
    const opts = { runtimeRef: 'box_session_1' };

    assert.equal(await adapter.exists('/workspace', resolved.stateDirRef, opts), false);
    await adapter.mkdirp('/workspace', resolved.stateDirRef, opts);
    assert.equal(await adapter.exists('/workspace', resolved.stateDirRef, opts), true);
    assert.equal(client.calls[0].sessionName, 'box_session_1');
    assert.equal(client.calls[0].command, 'test');
    assert.equal(client.calls[1].command, 'mkdir');
    assert.equal(client.calls[1].args[1], '/workspace/.xensemble/state/sess_box');
});
