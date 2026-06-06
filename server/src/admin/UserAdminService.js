const crypto = require('crypto');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq, and, sql, inArray } = require('drizzle-orm');
const auth = require('../auth/index');
const policy = require('../auth/PolicyService');
const platformSettings = require('./PlatformSettings');
const { recordEvent } = require('../events/recordEvent');

function formatUserRow(user, extras = {}) {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status || 'active',
        email: user.email || null,
        display_name: user.displayName || null,
        created_at: user.createdAt,
        last_login_at: user.lastLoginAt || null,
        ...extras,
    };
}

async function countActiveAdmins(excludeUserId = null) {
    const rows = await db
        .select({ count: sql`count(*)` })
        .from(schema.users)
        .where(and(
            eq(schema.users.role, 'admin'),
            eq(schema.users.status, 'active'),
        ));
    let count = Number(rows[0]?.count ?? 0);
    if (excludeUserId) {
        const target = await getUserById(excludeUserId);
        if (target?.role === 'admin' && target?.status === 'active') count -= 1;
    }
    return count;
}

async function getUserById(userId) {
    const rows = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    return rows[0] ?? null;
}

async function getUsageSummary(userId) {
    const usage = await policy.getUsage(userId);
    return {
        projects_count: usage.projects,
        active_sessions: usage.sessions,
        active_previews: usage.previews,
    };
}

async function listUsers() {
    const users = await db.select().from(schema.users);
    users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const result = [];
    for (const user of users) {
        const usage = await getUsageSummary(user.id);
        const quota = await policy.ensureUserQuota(user.id);
        const grants = await db
            .select({ agentId: schema.userAgentGrants.agentId })
            .from(schema.userAgentGrants)
            .where(eq(schema.userAgentGrants.userId, user.id));
        result.push(formatUserRow(user, {
            ...usage,
            quotas: {
                max_projects: quota.maxProjects,
                max_sessions: quota.maxSessions,
                max_previews: quota.maxPreviews,
                resource_tier: quota.resourceTier,
            },
            granted_agents_count: user.role === 'admin' ? null : grants.length,
        }));
    }
    return result;
}

async function getUserDetail(userId) {
    const user = await getUserById(userId);
    if (!user) return null;
    const quota = await policy.getEffectiveQuota(userId);
    const grants = await policy.listGrantedAgentIds(userId, user.role);
    return {
        ...formatUserRow(user, await getUsageSummary(userId)),
        quotas: quota,
        granted_agent_ids: grants,
    };
}

async function createUser({ username, password, role = 'user', status = 'active', displayName, email, quota, agentIds }, createdBy) {
    if (!username || !password) {
        throw Object.assign(new Error('username and password are required'), { statusCode: 400 });
    }
    if (password.length < 8) {
        throw Object.assign(new Error('Password must be at least 8 characters'), { statusCode: 400 });
    }

    const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const usersCount = await db.select({ count: sql`count(*)` }).from(schema.users);
    const effectiveRole = usersCount[0].count === 0 ? 'admin' : role;
    const effectiveStatus = usersCount[0].count === 0 ? 'active' : status;

    try {
        await db.insert(schema.users).values({
            id: userId,
            username,
            passwordHash: auth.hashPassword(password),
            role: effectiveRole,
            status: effectiveStatus,
            email: email || null,
            displayName: displayName || null,
            createdAt: now,
            updatedAt: now,
        });
    } catch (err) {
        if (/UNIQUE|unique/i.test(String(err.message))) {
            throw Object.assign(new Error('Username already exists'), { statusCode: 400 });
        }
        throw err;
    }

    const defaults = await platformSettings.getDefaultUserQuota();
    await db.insert(schema.userQuotas).values({
        userId,
        maxProjects: quota?.max_projects ?? defaults.max_projects ?? policy.DEFAULT_QUOTA.maxProjects,
        maxSessions: quota?.max_sessions ?? defaults.max_sessions ?? policy.DEFAULT_QUOTA.maxSessions,
        maxPreviews: quota?.max_previews ?? defaults.max_previews ?? policy.DEFAULT_QUOTA.maxPreviews,
        maxRuntimes: quota?.max_runtimes ?? defaults.max_runtimes ?? policy.DEFAULT_QUOTA.maxRuntimes,
        resourceTier: quota?.resource_tier ?? defaults.resource_tier ?? policy.DEFAULT_QUOTA.resourceTier,
        updatedBy: createdBy ?? null,
        updatedAt: now,
    });

    if (Array.isArray(agentIds) && agentIds.length > 0) {
        await setUserAgents(userId, agentIds, createdBy);
    }

    await recordEvent({
        userId: createdBy,
        subjectType: 'user',
        subjectId: userId,
        type: 'created',
        data: { username, role: effectiveRole, status: effectiveStatus },
    });

    return getUserDetail(userId);
}

async function registerUser({ username, password }) {
    if (!username || !password) {
        throw Object.assign(new Error('username and password are required'), { statusCode: 400 });
    }
    if (password.length < 8) {
        throw Object.assign(new Error('Password must be at least 8 characters'), { statusCode: 400 });
    }

    const mode = await platformSettings.getRegistrationMode();
    if (mode === 'admin_only') {
        throw Object.assign(new Error('Registration is disabled. Contact an administrator.'), { statusCode: 403, code: 'registration_disabled' });
    }
    if (mode === 'invite_only') {
        throw Object.assign(new Error('Registration requires an invite.'), { statusCode: 403, code: 'registration_requires_invite' });
    }

    const usersCount = await db.select({ count: sql`count(*)` }).from(schema.users);
    const isFirst = usersCount[0].count === 0;
    const role = isFirst ? 'admin' : 'user';
    const status = mode === 'approval' && !isFirst ? 'pending' : 'active';

    const user = await createUser({ username, password, role, status }, null);
    return { user, status, autoLogin: status === 'active' };
}

async function updateUser(userId, patch, actorId) {
    const user = await getUserById(userId);
    if (!user) return null;

    const updates = { updatedAt: Date.now() };
    if (patch.display_name !== undefined) updates.displayName = patch.display_name || null;
    if (patch.email !== undefined) updates.email = patch.email || null;

    if (patch.role !== undefined && patch.role !== user.role) {
        if (user.role === 'admin' && patch.role !== 'admin') {
            const admins = await countActiveAdmins(userId);
            if (admins < 1) {
                throw Object.assign(new Error('Cannot demote the last active administrator'), { statusCode: 400 });
            }
        }
        updates.role = patch.role;
    }

    if (patch.status !== undefined && patch.status !== user.status) {
        if (user.role === 'admin' && patch.status !== 'active') {
            const admins = await countActiveAdmins(userId);
            if (admins < 1) {
                throw Object.assign(new Error('Cannot suspend the last active administrator'), { statusCode: 400 });
            }
        }
        updates.status = patch.status;
        await recordEvent({
            userId: actorId,
            subjectType: 'user',
            subjectId: userId,
            type: patch.status === 'active' ? 'activated' : 'suspended',
            data: { from: user.status, to: patch.status },
        });
    }

    if (Object.keys(updates).length > 1) {
        await db.update(schema.users).set(updates).where(eq(schema.users.id, userId));
    }

    return getUserDetail(userId);
}

async function suspendUser(userId, actorId) {
    return updateUser(userId, { status: 'suspended' }, actorId);
}

async function setUserQuota(userId, quotaPatch, actorId) {
    await policy.ensureUserQuota(userId);
    const before = await policy.ensureUserQuota(userId);
    const updates = { updatedBy: actorId, updatedAt: Date.now() };

    if (quotaPatch.max_projects !== undefined) updates.maxProjects = quotaPatch.max_projects;
    if (quotaPatch.max_sessions !== undefined) updates.maxSessions = quotaPatch.max_sessions;
    if (quotaPatch.max_previews !== undefined) updates.maxPreviews = quotaPatch.max_previews;
    if (quotaPatch.max_runtimes !== undefined) updates.maxRuntimes = quotaPatch.max_runtimes;
    if (quotaPatch.resource_tier !== undefined) updates.resourceTier = quotaPatch.resource_tier;

    await db.update(schema.userQuotas).set(updates).where(eq(schema.userQuotas.userId, userId));

    await recordEvent({
        userId: actorId,
        subjectType: 'user',
        subjectId: userId,
        type: 'quota_updated',
        data: { before: policy.formatQuota(before, await policy.getUsage(userId)), patch: quotaPatch },
    });

    return policy.getEffectiveQuota(userId);
}

async function setUserAgents(userId, agentIds, actorId) {
    const uniqueIds = [...new Set(agentIds)];
    if (uniqueIds.length > 0) {
        const existing = await db.select({ id: schema.agents.id }).from(schema.agents)
            .where(inArray(schema.agents.id, uniqueIds));
        const found = new Set(existing.map((a) => a.id));
        const missing = uniqueIds.filter((id) => !found.has(id));
        if (missing.length > 0) {
            throw Object.assign(new Error(`Unknown agent(s): ${missing.join(', ')}`), { statusCode: 400 });
        }
    }

    await db.delete(schema.userAgentGrants).where(eq(schema.userAgentGrants.userId, userId));

    const now = Date.now();
    for (const agentId of uniqueIds) {
        await db.insert(schema.userAgentGrants).values({
            userId,
            agentId,
            grantedBy: actorId,
            grantedAt: now,
        });
    }

    await recordEvent({
        userId: actorId,
        subjectType: 'user',
        subjectId: userId,
        type: 'agent_granted',
        data: { agent_ids: uniqueIds },
    });

    return uniqueIds;
}

async function grantAgent(userId, agentId, actorId) {
    const grants = await db.select().from(schema.userAgentGrants)
        .where(and(eq(schema.userAgentGrants.userId, userId), eq(schema.userAgentGrants.agentId, agentId)));
    if (grants.length > 0) return grants[0];

    const now = Date.now();
    await db.insert(schema.userAgentGrants).values({
        userId,
        agentId,
        grantedBy: actorId,
        grantedAt: now,
    });

    await recordEvent({
        userId: actorId,
        subjectType: 'user',
        subjectId: userId,
        type: 'agent_granted',
        data: { agent_id: agentId },
    });

    return { userId, agentId };
}

async function revokeAgent(userId, agentId, actorId) {
    await db.delete(schema.userAgentGrants).where(and(
        eq(schema.userAgentGrants.userId, userId),
        eq(schema.userAgentGrants.agentId, agentId),
    ));

    await recordEvent({
        userId: actorId,
        subjectType: 'user',
        subjectId: userId,
        type: 'agent_revoked',
        data: { agent_id: agentId },
    });

    return { ok: true };
}

async function resetPassword(userId, newPassword, actorId) {
    if (!newPassword || newPassword.length < 8) {
        throw Object.assign(new Error('Password must be at least 8 characters'), { statusCode: 400 });
    }
    const user = await getUserById(userId);
    if (!user) return null;

    await db.update(schema.users).set({
        passwordHash: auth.hashPassword(newPassword),
        updatedAt: Date.now(),
    }).where(eq(schema.users.id, userId));

    await recordEvent({
        userId: actorId,
        subjectType: 'user',
        subjectId: userId,
        type: 'password_reset',
        data: { by_admin: actorId !== userId },
    });

    return { ok: true };
}

async function loginUser(username, password) {
    const users = await db.select().from(schema.users).where(eq(schema.users.username, username));
    if (users.length === 0 || !auth.verifyPassword(password, users[0].passwordHash)) {
        throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    }
    const user = users[0];
    const status = user.status || 'active';

    if (status === 'pending') {
        throw Object.assign(new Error('Account pending approval'), { statusCode: 403, code: 'account_pending' });
    }
    if (status === 'suspended') {
        throw Object.assign(new Error('Account suspended'), { statusCode: 403, code: 'account_suspended' });
    }

    await db.update(schema.users).set({ lastLoginAt: Date.now() }).where(eq(schema.users.id, user.id));
    await policy.ensureUserQuota(user.id);

    const token = auth.generateToken(user);
    const quotas = await policy.getEffectiveQuota(user.id);
    return {
        token,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            status,
        },
        quotas,
    };
}

async function getMe(userId) {
    const user = await getUserById(userId);
    if (!user) return null;
    const quotas = await policy.getEffectiveQuota(userId);
    const granted = await policy.listGrantedAgentIds(userId, user.role);
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status || 'active',
        display_name: user.displayName || null,
        email: user.email || null,
        quotas,
        granted_agents_count: user.role === 'admin' ? null : granted.length,
    };
}

module.exports = {
    listUsers,
    getUserDetail,
    getUserById,
    createUser,
    registerUser,
    updateUser,
    suspendUser,
    setUserQuota,
    setUserAgents,
    grantAgent,
    revokeAgent,
    resetPassword,
    loginUser,
    getMe,
};
