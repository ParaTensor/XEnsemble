const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const LocalFsAdapter = require('./LocalFsAdapter');
const { resolveSafePath } = require('../workspace');

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

test('fsList hides platform system directories', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, '.agents'));
        fs.writeFileSync(path.join(tmp, '.agents', 'preview.json'), '{}');
        fs.mkdirSync(path.join(tmp, '.git', 'hooks'), { recursive: true });
        fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules');
        fs.writeFileSync(path.join(tmp, 'index.html'), '<html></html>');
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, '.');
        const paths = list.map((item) => item.path).sort();
        assert.deepStrictEqual(paths, ['.gitignore', 'index.html']);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsList includes hidden platform directories when requested', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, '.agents'));
        fs.writeFileSync(path.join(tmp, '.agents', 'preview.json'), '{}');
        fs.writeFileSync(path.join(tmp, 'index.html'), '<html></html>');
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, '.', { includeHidden: true });
        const paths = list.map((item) => item.path).sort();
        assert.ok(paths.includes('.agents'));
        assert.ok(paths.includes('.agents/preview.json'));
        assert.ok(paths.includes('index.html'));
    } finally {
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

test('resolveStateDir returns a path under workspace root', () => {
    const adapter = new LocalFsAdapter();
    const resolved = adapter.resolveStateDir('/tmp/workspace', 'sess_abc');
    assert.match(resolved.stateDirRef, /\.xensemble[/\\]state[/\\]sess_abc$/);
    assert.match(resolved.stateDirPath, /sess_abc$/);
});

test('mkdirp and exists manage session state dirs through runtime FS', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-state-'));
    const adapter = new LocalFsAdapter();
    const sessionId = 'sess_state_dir';
    try {
        const resolved = adapter.resolveStateDir(tmp, sessionId);
        assert.equal(await adapter.exists(tmp, resolved.stateDirRef), false);
        await adapter.mkdirp(tmp, resolved.stateDirRef);
        assert.equal(await adapter.exists(tmp, resolved.stateDirRef), true);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── 2.A.1: fsList depth parameter ───

test('fsList with depth=single returns only direct children (not recursive)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'src'));
        fs.mkdirSync(path.join(tmp, 'src', 'nested'));
        fs.writeFileSync(path.join(tmp, 'src', 'main.js'), 'x');
        fs.writeFileSync(path.join(tmp, 'src', 'nested', 'deep.js'), 'y');
        fs.writeFileSync(path.join(tmp, 'readme.md'), 'z');
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, 'src', { depth: 'single' });
        const names = list.map((e) => e.name).sort();
        assert.deepStrictEqual(names, ['main.js', 'nested']);
        assert.strictEqual(list.length, 2, 'should only have 2 direct children');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsList without depth returns recursive full tree (regression)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'src'));
        fs.mkdirSync(path.join(tmp, 'src', 'nested'));
        fs.writeFileSync(path.join(tmp, 'src', 'main.js'), 'x');
        fs.writeFileSync(path.join(tmp, 'src', 'nested', 'deep.js'), 'y');
        fs.writeFileSync(path.join(tmp, 'readme.md'), 'z');
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, '.');
        const paths = list.map((e) => e.path).sort();
        assert.ok(paths.includes('readme.md'));
        assert.ok(paths.includes('src/main.js'));
        assert.ok(paths.includes('src/nested/deep.js'));
        assert.strictEqual(list.length, 5, 'should include all 5 entries recursively (2 files + 3 dirs)');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── 2.A.2: fsList return fields with size ───

test('fsList returns size for files and no size for directories', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'src'));
        fs.writeFileSync(path.join(tmp, 'src', 'main.js'), 'hello world');
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, 'src', { depth: 'single' });
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].name, 'main.js');
        assert.strictEqual(list[0].type, 'file');
        assert.strictEqual(typeof list[0].size, 'number');
        assert.strictEqual(list[0].size, 11);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsList returns unified fields { name, path, type, size? }', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'lib'));
        fs.writeFileSync(path.join(tmp, 'index.js'), 'export default 1;');
        const adapter = new LocalFsAdapter();
        const list = await adapter.fsList(tmp, '.', { depth: 'single' });
        for (const entry of list) {
            assert.ok(typeof entry.name === 'string', 'name should be string');
            assert.ok(typeof entry.path === 'string', 'path should be string');
            assert.ok(entry.type === 'file' || entry.type === 'directory', 'type should be file or directory');
            if (entry.type === 'file') {
                assert.ok(typeof entry.size === 'number', 'file should have size');
            }
            if (entry.type === 'directory') {
                assert.ok(entry.size === undefined, 'directory should not have size');
            }
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── 2.A.3: fsRead encoding parameter ───

test('fsRead with encoding=utf8 returns string', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.writeFileSync(path.join(tmp, 'hello.txt'), 'hello utf8');
        const adapter = new LocalFsAdapter();
        const content = await adapter.fsRead(tmp, 'hello.txt', { encoding: 'utf8' });
        assert.strictEqual(typeof content, 'string');
        assert.strictEqual(content, 'hello utf8');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRead with encoding=buffer returns Buffer', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.writeFileSync(path.join(tmp, 'data.bin'), 'hello binary');
        const adapter = new LocalFsAdapter();
        const content = await adapter.fsRead(tmp, 'data.bin', { encoding: 'buffer' });
        assert.ok(Buffer.isBuffer(content), 'should return Buffer');
        assert.strictEqual(content.toString('utf8'), 'hello binary');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRead defaults to utf8 without encoding option (regression)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.writeFileSync(path.join(tmp, 'note.txt'), 'default utf8');
        const adapter = new LocalFsAdapter();
        const content = await adapter.fsRead(tmp, 'note.txt');
        assert.strictEqual(typeof content, 'string');
        assert.strictEqual(content, 'default utf8');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── 2.A.4: fsWrite ───

test('fsWrite creates new file with mkdirp for parent directories', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        const result = await adapter.fsWrite(tmp, 'deep/nested/hello.txt', 'hello world');
        assert.ok(result, 'should return result');
        assert.strictEqual(result.path, 'deep/nested/hello.txt');
        assert.strictEqual(typeof result.size, 'number');
        const content = fs.readFileSync(path.join(tmp, 'deep/nested/hello.txt'), 'utf8');
        assert.strictEqual(content, 'hello world');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsWrite overwrites existing file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.writeFileSync(path.join(tmp, 'existing.txt'), 'old content');
        const adapter = new LocalFsAdapter();
        const result = await adapter.fsWrite(tmp, 'existing.txt', 'new content');
        assert.strictEqual(result.path, 'existing.txt');
        const content = fs.readFileSync(path.join(tmp, 'existing.txt'), 'utf8');
        assert.strictEqual(content, 'new content');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsWrite rejects traversal path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        await assert.rejects(
            () => adapter.fsWrite(tmp, '../..secret', 'bad'),
            /Access denied/,
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── 2.A.5: fsDelete ───

test('fsDelete removes a file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.writeFileSync(path.join(tmp, 'delete-me.txt'), 'bye');
        const adapter = new LocalFsAdapter();
        await adapter.fsDelete(tmp, 'delete-me.txt');
        assert.strictEqual(fs.existsSync(path.join(tmp, 'delete-me.txt')), false);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsDelete rejects directory with RuntimeError 400', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'mydir'));
        const adapter = new LocalFsAdapter();
        let err;
        try {
            await adapter.fsDelete(tmp, 'mydir');
        } catch (e) {
            err = e;
        }
        assert.ok(err, 'should throw');
        assert.strictEqual(err.statusCode, 400);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsDelete returns 404 for non-existent file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        let err;
        try {
            await adapter.fsDelete(tmp, 'nonexistent.txt');
        } catch (e) {
            err = e;
        }
        assert.ok(err, 'should throw');
        assert.strictEqual(err.statusCode, 404);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsDelete rejects traversal path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        await assert.rejects(
            () => adapter.fsDelete(tmp, '../..secret'),
            /Access denied/,
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── 2.A.6: fsMove ───

test('fsMove renames a file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.writeFileSync(path.join(tmp, 'old.txt'), 'data');
        const adapter = new LocalFsAdapter();
        await adapter.fsMove(tmp, 'old.txt', 'new.txt');
        assert.strictEqual(fs.existsSync(path.join(tmp, 'old.txt')), false);
        assert.strictEqual(fs.readFileSync(path.join(tmp, 'new.txt'), 'utf8'), 'data');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsMove moves a directory', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'olddir'));
        fs.writeFileSync(path.join(tmp, 'olddir', 'file.js'), 'code');
        const adapter = new LocalFsAdapter();
        await adapter.fsMove(tmp, 'olddir', 'newdir');
        assert.strictEqual(fs.existsSync(path.join(tmp, 'olddir')), false);
        assert.strictEqual(fs.readFileSync(path.join(tmp, 'newdir', 'file.js'), 'utf8'), 'code');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsMove returns 409 when target already exists', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.writeFileSync(path.join(tmp, 'a.txt'), 'a');
        fs.writeFileSync(path.join(tmp, 'b.txt'), 'b');
        const adapter = new LocalFsAdapter();
        let err;
        try {
            await adapter.fsMove(tmp, 'a.txt', 'b.txt');
        } catch (e) {
            err = e;
        }
        assert.ok(err, 'should throw');
        assert.strictEqual(err.statusCode, 409);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsMove rejects traversal path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        await assert.rejects(
            () => adapter.fsMove(tmp, '../..secret', 'here'),
            /Access denied/,
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── 2.A.7: fsRmdir ───

test('fsRmdir removes empty directory', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'emptydir'));
        const adapter = new LocalFsAdapter();
        await adapter.fsRmdir(tmp, 'emptydir');
        assert.strictEqual(fs.existsSync(path.join(tmp, 'emptydir')), false);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRmdir recursively removes non-empty directory', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        fs.mkdirSync(path.join(tmp, 'nonempty'));
        fs.writeFileSync(path.join(tmp, 'nonempty', 'child.js'), 'code');
        fs.mkdirSync(path.join(tmp, 'nonempty', 'sub'));
        const adapter = new LocalFsAdapter();
        await adapter.fsRmdir(tmp, 'nonempty');
        assert.strictEqual(fs.existsSync(path.join(tmp, 'nonempty')), false);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRmdir rejects deleting root (empty path)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        let err;
        try {
            await adapter.fsRmdir(tmp, '');
        } catch (e) {
            err = e;
        }
        assert.ok(err, 'should throw');
        assert.strictEqual(err.statusCode, 400);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fsRmdir rejects deleting root (dot)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const adapter = new LocalFsAdapter();
        let err;
        try {
            await adapter.fsRmdir(tmp, '.');
        } catch (e) {
            err = e;
        }
        assert.ok(err, 'should throw');
        assert.strictEqual(err.statusCode, 400);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── 2.A.8: resolveSafePath P0 security (regression) ───

test('resolveSafePath returns null for .. traversal', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    try {
        const result = resolveSafePath(tmp, '../..secret');
        assert.strictEqual(result, null);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('resolveSafePath returns null for null byte', () => {
    const result = resolveSafePath('/workspace', 'file\0.txt');
    assert.strictEqual(result, null);
});

test('resolveSafePath returns null for escape symlink', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xe-fs-'));
    const outsideFile = path.join(os.tmpdir(), 'xe-outside-' + Date.now() + '.txt');
    try {
        fs.writeFileSync(outsideFile, 'outside');
        fs.symlinkSync(outsideFile, path.join(tmp, 'escape.txt'));
        const result = resolveSafePath(tmp, 'escape.txt');
        assert.strictEqual(result, null);
    } finally {
        fs.rmSync(outsideFile, { force: true });
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
