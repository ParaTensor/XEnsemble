const { test } = require('node:test');
const assert = require('node:assert');
const { FsAdapter } = require('./interfaces');

test('FsAdapter base class fsWrite throws NotImplementedError', async () => {
    const adapter = new FsAdapter();
    await assert.rejects(
        () => adapter.fsWrite('/root', 'file.txt', 'content'),
        /FsAdapter\.fsWrite not implemented/,
    );
});

test('FsAdapter base class fsDelete throws NotImplementedError', async () => {
    const adapter = new FsAdapter();
    await assert.rejects(
        () => adapter.fsDelete('/root', 'file.txt'),
        /FsAdapter\.fsDelete not implemented/,
    );
});

test('FsAdapter base class fsMove throws NotImplementedError', async () => {
    const adapter = new FsAdapter();
    await assert.rejects(
        () => adapter.fsMove('/root', 'a.txt', 'b.txt'),
        /FsAdapter\.fsMove not implemented/,
    );
});

test('FsAdapter base class fsRmdir throws NotImplementedError', async () => {
    const adapter = new FsAdapter();
    await assert.rejects(
        () => adapter.fsRmdir('/root', 'dir'),
        /FsAdapter\.fsRmdir not implemented/,
    );
});