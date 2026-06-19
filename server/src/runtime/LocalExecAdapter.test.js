const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LocalExecAdapter = require('./LocalExecAdapter');

test('exec runs a simple command', async () => {
    const adapter = new LocalExecAdapter();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-test-'));
    try {
        const result = await adapter.exec('echo', ['hello'], {}, { cwd: tmp });
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.stdout.trim(), 'hello');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('exec fails when cwd is missing', async () => {
    const adapter = new LocalExecAdapter();
    await assert.rejects(() => adapter.exec('echo', ['hello'], {}, {}), /workspace directory is required/);
});

test('exec rejects with 504 when output exceeds maxBuffer', async () => {
    const adapter = new LocalExecAdapter();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-test-'));
    try {
        await assert.rejects(
            () => adapter.exec(
                'node',
                ['-e', "process.stdout.write('a'.repeat(256))"],
                {},
                { cwd: tmp, maxBuffer: 100 }
            ),
            (err) => {
                assert.strictEqual(err.name, 'AgentSpawnError');
                assert.strictEqual(err.statusCode, 504);
                assert.match(err.message, /maxBuffer/i);
                return true;
            }
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('exec truncates output to maxOutput', async () => {
    const adapter = new LocalExecAdapter();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-test-'));
    try {
        const result = await adapter.exec(
            'node',
            ['-e', "process.stdout.write('b'.repeat(500))"],
            {},
            { cwd: tmp, maxOutput: 100 }
        );
        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.stdout.length, 100);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('exec captures non-zero exit code', async () => {
    const adapter = new LocalExecAdapter();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-test-'));
    try {
        const result = await adapter.exec('node', ['-e', 'process.exit(7)'], {}, { cwd: tmp });
        assert.strictEqual(result.exitCode, 7);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('exec kills long-running command when timeoutMs is reached', async () => {
    const adapter = new LocalExecAdapter();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-test-'));
    try {
        await assert.rejects(
            () => adapter.exec('sleep', ['10'], {}, { cwd: tmp, timeoutMs: 100 }),
            (err) => {
                assert.strictEqual(err.name, 'AgentSpawnError');
                assert.strictEqual(err.statusCode, 504);
                return true;
            }
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
