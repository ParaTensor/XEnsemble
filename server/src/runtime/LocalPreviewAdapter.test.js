const { test } = require('node:test');
const assert = require('node:assert');
const LocalPreviewAdapter = require('./LocalPreviewAdapter');

test('startPreview requires deploymentId', async () => {
    const adapter = new LocalPreviewAdapter();
    await assert.rejects(() => adapter.startPreview({}, {}), /deploymentId is required/);
});
