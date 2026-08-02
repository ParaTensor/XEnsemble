const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { GitConnectionService } = require('./GitConnectionService');

describe('GitConnectionService legacy facade', () => {
    it('exposes GitHub-compatible methods that delegate to generic git service', () => {
        const service = new GitConnectionService();
        assert.equal(typeof service.initiateOAuth, 'function');
        assert.equal(typeof service.getConnection, 'function');
        assert.equal(typeof service.getDecryptedToken, 'function');
        assert.equal(typeof service.disconnect, 'function');
        assert.equal(typeof service.completeOAuthFromCallback, 'function');
        assert.equal(typeof service.completeOAuthFromDesktop, 'function');
        assert.ok(service.inner);
    });
});
