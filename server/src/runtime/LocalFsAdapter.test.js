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

test('fsList rejects traversal', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.writeFileSync(path.join(tmp, 'secret.txt'), 'secret');
        const adapter = new LocalFsAdapter();
        await assert.rejects(() => adapter.fsList(tmp, '../..secret'), /Access denied/);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRead blocks traversal', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        await assert.rejects(() => adapter.fsRead(tmp, '../etc/passwd'));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRead rejects null byte', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        await assert.rejects(() => adapter.fsRead(tmp, 'file\0.txt'), /Access denied/);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRead works under symlinked root', async () => {
    const realTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-real-'));
    const linkTmp = path.join(os.tmpdir(), 'xe-link-' + Date.now());
    try {
        fs.symlinkSync(realTmp, linkTmp, 'dir');
        fs.writeFileSync(path.join(realTmp, 'note.txt'), 'hello');
        const adapter = new LocalFsAdapter();
        const content = await adapter.fsRead(linkTmp, 'note.txt');
        assert.strictEqual(content, 'hello');
    } finally {
        fs.rmSync(linkTmp, { force: true });
        fs.rmSync(realTmp, { recursive: true, force: true });
    }
});

test('fsList does not follow escape symlinks', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    const outsideFile = path.join(os.tmpdir(), 'xe-outside-' + Date.now() + '.txt');
    try {
        fs.writeFileSync(outsideFile, 'outside');
        fs.symlinkSync(outsideFile, path.join(tmp, 'escape.txt'));
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, '.');
        assert.strictEqual(list.length, 0);
    } finally {
        fs.rmSync(outsideFile, { force: true });
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsList returns empty list for non-existent path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, 'missing');
        assert.deepStrictEqual(list, []);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRead throws for non-existent path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        await assert.rejects(() => adapter.fsRead(tmp, 'missing.txt'), /File not found/);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRead rejects intermediate symlink to non-existent outside target', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-outside-'));
    try {
        fs.rmSync(outsideDir, { recursive: true, force: true });
        fs.symlinkSync(outsideDir, path.join(tmp, 'escape'), 'dir');
        const adapter = new LocalFsAdapter();
        await assert.rejects(() => adapter.fsRead(tmp, 'escape/missing.txt'), /Access denied|403/);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
