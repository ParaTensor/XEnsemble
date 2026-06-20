const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LocalFsAdapter = require('./LocalFsAdapter');

test('fsList respects relative path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'src'));
        fs.writeFileSync(path.join(tmp, 'src', 'main.js'), 'x');
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, 'src');
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].name, 'main.js');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRead blocks traversal', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        await assert.rejects(() => adapter.fsRead(tmp, '../etc/passwd'), /Access denied/);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
