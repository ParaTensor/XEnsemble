const crypto = require('crypto');
const { db } = require('../db/index');
const schema = require('../db/schema');

/**
 * 写入 events 表（Lifecycle / 审计，Architecture.md 第 4 节）。
 */
async function recordEvent({ userId, projectId, subjectType, subjectId, type, data }) {
    await db.insert(schema.events).values({
        id: `evt_${crypto.randomBytes(8).toString('hex')}`,
        userId: userId ?? null,
        projectId: projectId ?? null,
        subjectType,
        subjectId,
        type,
        data: data != null ? JSON.stringify(data) : null,
        createdAt: Date.now(),
    });
}

module.exports = { recordEvent };
