const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LocalExecAdapter = require('./LocalExecAdapter');

test('exec runs a simple command', async () => {
    const adapter = new LocalExecAdapter();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-test-'));
    const result = await adapter.exec('echo', ['hello'], {}, { cwd: tmp });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), 'hello');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('exec fails when cwd is missing', async () => {
    const adapter = new LocalExecAdapter();
    await assert.rejects(() => adapter.exec('echo', ['hello'], {}, {}), /workspace directory is required/);
});
