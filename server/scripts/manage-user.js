#!/usr/bin/env node
/**
 * 本地运维：列出用户、提升/降级管理员、重置密码、创建管理员。
 * 通过 DATABASE_URL 连接 PostgreSQL（与后端相同）。
 *
 * 用法：
 *   node scripts/manage-user.js list
 *   node scripts/manage-user.js promote <username>
 *   node scripts/manage-user.js demote <username>
 *   node scripts/manage-user.js password <username> <new-password>
 *   node scripts/manage-user.js create-admin <username> <password>
 */
require('../src/db/index');

const crypto = require('crypto');
const { eq, sql, and } = require('drizzle-orm');
const { db } = require('../src/db/index');
const schema = require('../src/db/schema');
const auth = require('../src/auth/index');
const policy = require('../src/auth/PolicyService');
const platformSettings = require('../src/admin/PlatformSettings');
const { recordEvent } = require('../src/events/recordEvent');

function usage() {
    console.log(`Usage:
  node scripts/manage-user.js list
  node scripts/manage-user.js promote <username>
  node scripts/manage-user.js demote <username>
  node scripts/manage-user.js password <username> <new-password>
  node scripts/manage-user.js create-admin <username> <password>

Examples:
  node scripts/manage-user.js list
  node scripts/manage-user.js promote lipi
  node scripts/manage-user.js password lipi 'NewPass123'
  node scripts/manage-user.js create-admin admin 'AdminPass123'`);
}

async function findByUsername(username) {
    const rows = await db.select().from(schema.users).where(eq(schema.users.username, username));
    return rows[0] ?? null;
}

async function countActiveAdmins(excludeUserId = null) {
    const rows = await db
        .select({ count: sql`count(*)` })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'admin'), eq(schema.users.status, 'active')));
    let count = Number(rows[0]?.count ?? 0);
    if (excludeUserId) {
        const u = await db.select().from(schema.users).where(eq(schema.users.id, excludeUserId));
        if (u[0]?.role === 'admin' && (u[0]?.status || 'active') === 'active') count -= 1;
    }
    return count;
}

function assertPassword(password) {
    if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }
}

async function cmdList() {
    const users = await db.select().from(schema.users);
    users.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (users.length === 0) {
        console.log('No users in database.');
        return;
    }
    console.log('id\tusername\trole\tstatus\tlast_login');
    for (const u of users) {
        const last = u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : '—';
        console.log(`${u.id}\t${u.username}\t${u.role}\t${u.status || 'active'}\t${last}`);
    }
}

async function cmdPromote(username) {
    const user = await findByUsername(username);
    if (!user) throw new Error(`User not found: ${username}`);
    if (user.role === 'admin') {
        console.log(`User "${username}" is already admin.`);
        return;
    }
    await db.update(schema.users).set({
        role: 'admin',
        status: 'active',
        updatedAt: Date.now(),
    }).where(eq(schema.users.id, user.id));
    await recordEvent({
        subjectType: 'user',
        subjectId: user.id,
        type: 'activated',
        data: { action: 'cli_promote', username },
    });
    console.log(`Promoted "${username}" to admin (status=active).`);
}

async function cmdDemote(username) {
    const user = await findByUsername(username);
    if (!user) throw new Error(`User not found: ${username}`);
    if (user.role === 'user') {
        console.log(`User "${username}" is already a regular user.`);
        return;
    }
    const admins = await countActiveAdmins(user.id);
    if (admins < 1) {
        throw new Error('Cannot demote the last active administrator');
    }
    await db.update(schema.users).set({
        role: 'user',
        updatedAt: Date.now(),
    }).where(eq(schema.users.id, user.id));
    await recordEvent({
        subjectType: 'user',
        subjectId: user.id,
        type: 'suspended',
        data: { action: 'cli_demote', username },
    });
    console.log(`Demoted "${username}" to user.`);
}

async function cmdPassword(username, password) {
    assertPassword(password);
    const user = await findByUsername(username);
    if (!user) throw new Error(`User not found: ${username}`);
    await db.update(schema.users).set({
        passwordHash: auth.hashPassword(password),
        updatedAt: Date.now(),
    }).where(eq(schema.users.id, user.id));
    await recordEvent({
        subjectType: 'user',
        subjectId: user.id,
        type: 'password_reset',
        data: { action: 'cli_password', username },
    });
    console.log(`Password updated for "${username}".`);
}

async function cmdCreateAdmin(username, password) {
    assertPassword(password);
    const existing = await findByUsername(username);
    if (existing) {
        await cmdPassword(username, password);
        await cmdPromote(username);
        console.log(`Existing user "${username}" is now admin with new password.`);
        return;
    }

    const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const defaults = await platformSettings.getDefaultUserQuota();

    await db.insert(schema.users).values({
        id: userId,
        username,
        passwordHash: auth.hashPassword(password),
        role: 'admin',
        status: 'active',
        createdAt: now,
        updatedAt: now,
    });

    await db.insert(schema.userQuotas).values({
        userId,
        maxProjects: defaults.max_projects ?? policy.DEFAULT_QUOTA.maxProjects,
        maxSessions: defaults.max_sessions ?? policy.DEFAULT_QUOTA.maxSessions,
        maxPreviews: defaults.max_previews ?? policy.DEFAULT_QUOTA.maxPreviews,
        maxRuntimes: defaults.max_runtimes ?? policy.DEFAULT_QUOTA.maxRuntimes,
        resourceTier: defaults.resource_tier ?? policy.DEFAULT_QUOTA.resourceTier,
        updatedAt: now,
    });

    await recordEvent({
        subjectType: 'user',
        subjectId: userId,
        type: 'created',
        data: { action: 'cli_create_admin', username },
    });

    console.log(`Created admin "${username}" (${userId}).`);
}

async function main() {
    const [, , command, ...args] = process.argv;

    switch (command) {
        case 'list':
            await cmdList();
            break;
        case 'promote': {
            const username = args[0];
            if (!username) throw new Error('Missing username');
            await cmdPromote(username);
            break;
        }
        case 'demote': {
            const username = args[0];
            if (!username) throw new Error('Missing username');
            await cmdDemote(username);
            break;
        }
        case 'password': {
            const [username, password] = args;
            if (!username || !password) throw new Error('Usage: password <username> <new-password>');
            await cmdPassword(username, password);
            break;
        }
        case 'create-admin': {
            const [username, password] = args;
            if (!username || !password) throw new Error('Usage: create-admin <username> <password>');
            await cmdCreateAdmin(username, password);
            break;
        }
        case undefined:
        case '-h':
        case '--help':
        case 'help':
            usage();
            break;
        default:
            throw new Error(`Unknown command: ${command}`);
    }
}

main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
});
