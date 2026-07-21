const crypto = require('crypto');
const { eq, and, isNull, lte } = require('drizzle-orm');

const { db } = require('../db/index');
const schema = require('../db/schema');
const auth = require('../auth/index');
const { recordEvent } = require('../events/recordEvent');
const PlatformSettings = require('../admin/PlatformSettings');
const { GitHubService, getOAuthBase } = require('./GitHubService');

const STATE_TTL_MS = 5 * 60 * 1000;

// Token cache: userId -> { token, connectionId, expiresAt }
const TOKEN_CACHE_TTL_MS = 30_000;
const tokenCache = new Map();

// Throttle for fire-and-forget lastUsedAt writes: userId -> lastWriteTime
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedWriteThrottle = new Map();

/**
 * Fire-and-forget lastUsedAt update, throttled per user to at most once per
 * LAST_USED_THROTTLE_MS. This avoids DB write contention when multiple git
 * subcommands run in parallel within getStatus().
 */
function scheduleLastUsedUpdate(userId, connectionId) {
    const now = Date.now();
    const lastWrite = lastUsedWriteThrottle.get(userId) || 0;
    if (now - lastWrite < LAST_USED_THROTTLE_MS) return;
    lastUsedWriteThrottle.set(userId, now);
    db.update(schema.githubConnections)
        .set({ lastUsedAt: now })
        .where(eq(schema.githubConnections.id, connectionId))
        .catch(() => { /* fire-and-forget */ });
}

function invalidateTokenCache(userId) {
    tokenCache.delete(userId);
    lastUsedWriteThrottle.delete(userId);
}

class GitConnectionService {
    constructor(gitHubService = new GitHubService()) {
        this.gitHubService = gitHubService;
    }

    async initiateOAuth(userId) {
        if (!userId) {
            throw new Error('userId is required');
        }

        await this._pruneExpiredStates();

        const clientId = await PlatformSettings.get('GITHUB_CLIENT_ID');
        if (!clientId) {
            throw new Error('GitHub OAuth is not configured');
        }

        const state = crypto.randomBytes(16).toString('hex');
        const expiresAt = Date.now() + STATE_TTL_MS;

        await db.insert(schema.githubOAuthStates).values({
            state,
            userId,
            expiresAt,
        });

        const params = new URLSearchParams({
            client_id: String(clientId),
            state,
            scope: 'repo',
        });

        const callbackUrl = await PlatformSettings.get('GITHUB_CALLBACK_URL')
            || (process.env.CONTROL_PLANE_PUBLIC_URL
                ? `${process.env.CONTROL_PLANE_PUBLIC_URL}/api/v1/github/callback`
                : undefined);
        if (callbackUrl) {
            params.set('redirect_uri', String(callbackUrl));
        }

        const oauthBase = await getOAuthBase();
        return {
            authUrl: `${oauthBase}/login/oauth/authorize?${params.toString()}`,
            state,
        };
    }

    async completeOAuthFromCallback(code, state) {
        const stateRow = await this._consumeState(state);
        return this._finishConnection(stateRow.userId, code);
    }

    async completeOAuthFromDesktop(userId, code, state) {
        const stateRow = await this._consumeState(state);
        if (stateRow.userId !== userId) {
            throw new Error('OAuth state does not match the authenticated user');
        }
        return this._finishConnection(stateRow.userId, code);
    }

    async getConnection(userId) {
        const rows = await db
            .select()
            .from(schema.githubConnections)
            .where(and(
                eq(schema.githubConnections.userId, userId),
                isNull(schema.githubConnections.revokedAt),
            ));

        if (rows.length === 0) {
            return null;
        }

        return this._formatConnection(rows[0]);
    }

    async getDecryptedToken(userId) {
        // Check cache first to avoid DB SELECT + AES decrypt on every git subcommand.
        const cached = tokenCache.get(userId);
        if (cached && cached.expiresAt > Date.now()) {
            scheduleLastUsedUpdate(userId, cached.connectionId);
            return cached.token;
        }

        const rows = await db
            .select()
            .from(schema.githubConnections)
            .where(and(
                eq(schema.githubConnections.userId, userId),
                isNull(schema.githubConnections.revokedAt),
            ));

        if (rows.length === 0) {
            throw new Error('github_not_connected');
        }

        const row = rows[0];
        const secrets = auth.decryptSecrets(row.accessTokenEnc);
        const token = secrets.token ?? null;

        // Cache the decrypted token so parallel git subcommands don't each hit the DB.
        tokenCache.set(userId, {
            token,
            connectionId: row.id,
            expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
        });

        // Fire-and-forget, throttled per user.
        scheduleLastUsedUpdate(userId, row.id);

        return token;
    }

    async disconnect(userId) {
        invalidateTokenCache(userId);

        const rows = await db
            .select()
            .from(schema.githubConnections)
            .where(and(
                eq(schema.githubConnections.userId, userId),
                isNull(schema.githubConnections.revokedAt),
            ));

        if (rows.length === 0) {
            return;
        }

        const row = rows[0];
        const now = Date.now();

        await db
            .update(schema.githubConnections)
            .set({ revokedAt: now })
            .where(eq(schema.githubConnections.id, row.id));

        await recordEvent({
            userId,
            subjectType: 'github_connection',
            subjectId: row.id,
            type: 'github.disconnected',
            data: {},
        });
    }

    async _consumeState(state) {
        if (!state) {
            throw new Error('state is required');
        }

        await this._pruneExpiredStates();

        const rows = await db
            .select()
            .from(schema.githubOAuthStates)
            .where(eq(schema.githubOAuthStates.state, state));

        if (rows.length === 0) {
            throw new Error('Invalid or expired OAuth state');
        }

        await db
            .delete(schema.githubOAuthStates)
            .where(eq(schema.githubOAuthStates.state, state));

        return rows[0];
    }

    async _finishConnection(userId, code) {
        invalidateTokenCache(userId);
        const token = await this.gitHubService.exchangeOAuthCode(code);
        const ghUser = await this.gitHubService.getAuthenticatedUser(token);

        const encrypted = auth.encryptSecrets({ token });
        const now = Date.now();

        const id = `ghconn_${crypto.randomBytes(8).toString('hex')}`;

        // Always create a fresh connection record; remove any prior rows for this user.
        await db
            .delete(schema.githubConnections)
            .where(eq(schema.githubConnections.userId, userId));

        const connection = {
            id,
            userId,
            githubUserId: ghUser.id,
            githubUsername: ghUser.login,
            githubAvatar: ghUser.avatar_url || null,
            accessTokenEnc: encrypted,
            tokenScope: 'repo',
            connectedAt: now,
            lastUsedAt: now,
            revokedAt: null,
        };

        await db.insert(schema.githubConnections).values(connection);

        await recordEvent({
            userId,
            subjectType: 'github_connection',
            subjectId: id,
            type: 'github.connected',
            data: {
                githubUserId: ghUser.id,
                githubUsername: ghUser.login,
            },
        });

        return this._formatConnection(connection);
    }

    _formatConnection(row) {
        return {
            id: row.id,
            user_id: row.userId,
            github_user_id: row.githubUserId,
            github_username: row.githubUsername,
            github_avatar: row.githubAvatar,
            token_scope: row.tokenScope,
            connected_at: row.connectedAt,
            last_used_at: row.lastUsedAt,
        };
    }

    async _pruneExpiredStates() {
        await db
            .delete(schema.githubOAuthStates)
            .where(lte(schema.githubOAuthStates.expiresAt, Date.now()));
    }
}

module.exports = { GitConnectionService };
