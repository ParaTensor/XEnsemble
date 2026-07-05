const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    readPortsFile,
    upsertPreviewPort,
    removePreviewPort,
    getPreviewPort,
} = require('./previewPorts');

describe('previewPorts', () => {
    let tmpDir;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xensemble-ports-'));
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes and reads preview metadata', () => {
        const entry = upsertPreviewPort(tmpDir, 'dep_test', {
            port: 4321,
            public_url: 'http://localhost/preview/dep_test/',
            internal_ref: '127.0.0.1:4321',
        });
        assert.equal(entry.port, 4321);
        assert.equal(getPreviewPort(tmpDir, 'dep_test').port, 4321);

        const doc = readPortsFile(tmpDir);
        assert.equal(doc.primary_deployment_id, 'dep_test');
        assert.ok(doc.previews.dep_test);
    });

    it('removes preview and updates primary', () => {
        upsertPreviewPort(tmpDir, 'dep_a', { port: 1111 });
        upsertPreviewPort(tmpDir, 'dep_b', { port: 2222 });
        removePreviewPort(tmpDir, 'dep_b');
        assert.equal(getPreviewPort(tmpDir, 'dep_b'), null);
        assert.equal(readPortsFile(tmpDir).primary_deployment_id, 'dep_a');
    });
});
