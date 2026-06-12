const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { issueSessionToken, verifySessionToken, TOKEN_PREFIX } = require('./sessionToken');

describe('sessionToken', () => {
    it('issues and verifies a session token', () => {
        const token = issueSessionToken({
            sessionId: 'sess_abc',
            userId: 'user_1',
            projectId: 'proj_1',
            agentId: 'claude-code',
            model: 'claude-sonnet-4',
        });
        assert.ok(token.startsWith(TOKEN_PREFIX));
        const claims = verifySessionToken(token);
        assert.equal(claims.sid, 'sess_abc');
        assert.equal(claims.uid, 'user_1');
        assert.equal(claims.pid, 'proj_1');
        assert.equal(claims.aid, 'claude-code');
        assert.equal(claims.model, 'claude-sonnet-4');
    });

    it('rejects invalid tokens', () => {
        assert.equal(verifySessionToken(''), null);
        assert.equal(verifySessionToken('not-a-token'), null);
        assert.equal(verifySessionToken('xel_bad.payload.sig'), null);
    });
});
