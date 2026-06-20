const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('./index');
const userAdmin = require('../admin/UserAdminService');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');

test('access token expires quickly', () => {
    const token = auth.generateAccessToken({ id: 'u1', username: 'a', role: 'user', status: 'active' });
    const payload = auth.verifyAccessToken(token);
    assert.ok(payload.exp - payload.iat <= 900, 'expires in 15 minutes');
});

test('refresh token lifecycle', async () => {
    const raw = auth.generateRefreshTokenValue();
    const hash = auth.hashToken(raw);
    assert.strictEqual(hash.length, 64);
    // Token value should not be reconstructible from hash
    const raw2 = auth.generateRefreshTokenValue();
    assert.notStrictEqual(auth.hashToken(raw2), hash);
});

test('password hash upgrade', () => {
    const legacy = 'salt:hash';
    assert.strictEqual(auth.needsRehash(legacy), true);
    const modern = auth.hashPassword('password123');
    assert.strictEqual(auth.needsRehash(modern), false);
    assert.ok(auth.verifyPassword('password123', modern));
});
