const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');
const auth = require('./index');

async function assertActiveUser(token) {
    const payload = auth.verifyAccessToken(token);
    if (!payload?.id) {
        return { error: 'Unauthorized', status: 401 };
    }
    const rows = await db.select({ id: schema.users.id, status: schema.users.status })
        .from(schema.users)
        .where(eq(schema.users.id, payload.id));
    if (rows.length === 0) {
        return { error: 'Account is inactive', status: 403, code: 'account_inactive' };
    }
    const status = rows[0].status || 'active';
    if (status !== 'active') {
        const code = status === 'pending' ? 'account_pending' : 'account_suspended';
        return { error: 'Account is inactive', status: 403, code };
    }
    return { user: { id: rows[0].id, status } };
}

module.exports = { assertActiveUser };
