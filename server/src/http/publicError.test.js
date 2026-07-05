const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isDatabaseError, isUniqueViolation, sanitizePublicError } = require('./publicError');

describe('publicError', () => {
    it('detects drizzle duplicate key errors', () => {
        const err = new Error('Failed query: insert into "users"');
        err.cause = { code: '23505', message: 'duplicate key value violates unique constraint "users_username_unique"' };
        assert.equal(isDatabaseError(err), true);
        assert.equal(isUniqueViolation(err), true);
        assert.deepEqual(sanitizePublicError(err, 'Registration failed'), {
            statusCode: 400,
            message: 'Username already exists',
        });
    });

    it('passes through application errors with statusCode', () => {
        const err = Object.assign(new Error('Invalid credentials'), { statusCode: 401, code: 'invalid_credentials' });
        assert.equal(isDatabaseError(err), false);
        assert.deepEqual(sanitizePublicError(err, 'Login failed'), {
            statusCode: 401,
            message: 'Invalid credentials',
            code: 'invalid_credentials',
        });
    });

    it('hides unknown database errors', () => {
        const err = new Error('Failed query: select 1');
        err.cause = { code: 'XX000', message: 'internal secret detail' };
        assert.deepEqual(sanitizePublicError(err, 'Request failed'), {
            statusCode: 500,
            message: 'Request failed',
        });
    });
});
