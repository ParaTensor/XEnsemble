const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const auth = require('./index');

// User status cache: userId -> { status, expiresAt }
// Avoids a DB query on every authenticated request. JWT is already verified
// by the caller; we only need to check the user's account status periodically.
const STATUS_CACHE_TTL_MS = 30_000;
const statusCache = new Map();

function invalidateUserStatusCache(userId) {
    if (userId) {
        statusCache.delete(userId);
    } else {
        statusCache.clear();
    }
}

async function assertActiveUser(tokenOrPayload) {
    // Accept either a raw JWT token (legacy) or a pre-verified payload object.
    // When a payload is passed, skip the redundant second JWT verification.
    let payload;
    if (tokenOrPayload && typeof tokenOrPayload === 'object') {
        payload = tokenOrPayload;
    } else {
        payload = auth.verifyAccessToken(tokenOrPayload);
    }
    if (!payload?.id) {
        return { error: 'Unauthorized', status: 401 };
    }

    // Check cache first.
    const cached = statusCache.get(payload.id);
    if (cached && cached.expiresAt > Date.now()) {
        if (cached.status !== 'active') {
            const code = cached.status === 'pending' ? 'account_pending' : 'account_suspended';
            return { error: 'Account is inactive', status: 403, code };
        }
        return { user: { id: payload.id, status: cached.status } };
    }

    const rows = await db.select({ id: schema.users.id, status: schema.users.status })
        .from(schema.users)
        .where(eq(schema.users.id, payload.id));
    if (rows.length === 0) {
        return { error: 'Account is inactive', status: 403, code: 'account_inactive' };
    }
    const status = rows[0].status || 'active';

    // Cache the result.
    statusCache.set(payload.id, { status, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });

    if (status !== 'active') {
        const code = status === 'pending' ? 'account_pending' : 'account_suspended';
        return { error: 'Account is inactive', status: 403, code };
    }
    return { user: { id: rows[0].id, status } };
}

module.exports = { assertActiveUser, invalidateUserStatusCache };
