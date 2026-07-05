const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { probePort, parseInternalRef, isProcessAlive } = require('../runtime/previewHealth');

describe('previewHealth', () => {
    it('parseInternalRef extracts host and port', () => {
        assert.deepEqual(parseInternalRef('127.0.0.1:5173'), { host: '127.0.0.1', port: 5173 });
        assert.equal(parseInternalRef('bad'), null);
    });

    it('isProcessAlive returns true for current process', () => {
        assert.equal(isProcessAlive(process.pid), true);
        assert.equal(isProcessAlive(999999999), false);
    });

    it('probePort detects closed port', async () => {
        const ok = await probePort('127.0.0.1', 1, 200);
        assert.equal(ok, false);
    });
});
