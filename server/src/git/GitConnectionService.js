const crypto = require('crypto');
const { eq, and, isNull, lte } = require('drizzle-orm');

const { db } = require('../db/index');
const schema = require('../db/schema');
const auth = require('../auth/index');
const { recordEvent } = require('../events/recordEvent');
const PlatformSettings = require('../admin/PlatformSettings');
const PlatformSecrets = require('../admin/PlatformSecrets');
const { getProvider, hasProvider } = require('./providers/registry');

const STATE_TTL_MS = 5 * 60 * 1000;

// Token cache: `${userId}:${providerName}` -> { token, connectionId, expiresAt }
const TOKEN_CACHE_TTL_MS = 30_000;
const tokenCache = new Map();

// Throttle for fire-and-forget lastUsedAt writes: connectionId -> lastWriteTime
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedWriteThrottle = new Map();

function tokenCacheKey(userId, providerName) {
    return `${userId}:${providerName || '*'}`;
}

/**
 * Fire-and-forget lastUsedAt update, throttled per connection to at most once
 * per LAST_USED_THROTTLE_MS. This avoids DB write contention when multiple git
 * subcommands run in parallel within getStatus().
 */
function scheduleLastUsedUpdate(connectionId) {
    const now = Date.now();
    const lastWrite = lastUsedWriteThrottle.get(connectionId) || 0;
    if (now - lastWrite < LAST_USED_THROTTLE_MS) return;
    lastUsedWriteThrottle.set(connectionId, now);
    db.update(schema.gitConnections)
        .set({ lastUsedAt: now })
        .where(eq(schema.gitConnections.id, connectionId))
        .catch(() => { /* fire-and-forget */ });
}

function invalidateTokenCache(userId, providerName) {
    if (providerName) {
        tokenCache.delete(tokenCacheKey(userId, providerName));
    } else {
        // Invalidate all providers for this user
        const prefix = `${userId}:`;
        for (const key of tokenCache.keys()) {
            if (key.startsWith(prefix)) tokenCache.delete(key);
        }
    }
}

async function getProviderConfig(providerName) {
    const configKey = `GIT_PROVIDER_${providerName.toUpperCase()}_CONFIG`;
    const raw = await PlatformSettings.get(configKey);
    if (raw) {
        try { return JSON.parse(raw); } catch { /* fall through */ }
    }

    // Fallback: read legacy GitHub-specific settings
    if (providerName === 'github') {
        const clientId = await PlatformSettings.get('GITHUB_CLIENT_ID');
        const encryptedSecret = await PlatformSettings.get('GITHUB_CLIENT_SECRET');
        const clientSecret = encryptedSecret ? PlatformSecrets.getPlatformSecret(encryptedSecret) : null;
        const apiBase = await PlatformSettings.get('GITHUB_API_BASE');
        const callbackUrl = await PlatformSettings.get('GITHUB_CALLBACK_URL');
        if (clientId) {
            return {
                provider: 'github',
                enabled: true,
                clientId: String(clientId).trim(),
                clientSecret: clientSecret ? String(clientSecret).trim() : null,
                apiBase: apiBase ? String(apiBase).trim() : undefined,
                callbackUrl: callbackUrl ? String(callbackUrl) : undefined,
                scope: 'repo',
            };
        }
    }

    return null;
}

class GitConnectionService {
    async initiateOAuth(userId, providerName = 'github') {
        if (!userId) throw new Error('userId is required');
        if (!hasProvider(providerName)) throw new Error(`Unknown provider: ${providerName}`);

        await this._pruneExpiredStates();

        const config = await getProviderConfig(providerName);
        if (!config || !config.clientId) {
            throw new Error(`${providerName} OAuth is not configured`);
        }

        const state = crypto.randomBytes(16).toString('hex');
        const expiresAt = Date.now() + STATE_TTL_MS;

        await db.insert(schema.gitOAuthStates).values({
            state,
            userId,
            provider: providerName,
            expiresAt,
        });

        const callbackUrl = config.callbackUrl
            || (process.env.CONTROL_PLANE_PUBLIC_URL
                ? `${process.env.CONTROL_PLANE_PUBLIC_URL}/api/v1/git/callback`
                : undefined);

        const provider = getProvider(providerName);
        const authUrl = provider.buildAuthUrl({
            clientId: config.clientId,
            callbackUrl,
            state,
            scope: config.scope,
            apiBase: config.apiBase,
        });

        return { authUrl, state, provider: providerName };
    }

    async completeOAuthFromCallback(code, state) {
        const stateRow = await this._consumeState(state);
        return this._finishConnection(stateRow.userId, stateRow.provider, code);
    }

    async completeOAuthFromDesktop(userId, code, state) {
        const stateRow = await this._consumeState(state);
        if (stateRow.userId !== userId) {
            throw new Error('OAuth state does not match the authenticated user');
        }
        return this._finishConnection(stateRow.userId, stateRow.provider, code);
    }

    async getConnection(userId, providerName) {
        const where = [
            eq(schema.gitConnections.userId, userId),
            isNull(schema.gitConnections.revokedAt),
        ];
        if (providerName) {
            where.push(eq(schema.gitConnections.provider, providerName));
        }

        const rows = await db.select().from(schema.gitConnections)
            .where(and(...where));
        if (rows.length === 0) return null;
        return this._formatConnection(rows[0]);
    }

    async listConnections(userId) {
        const rows = await db.select().from(schema.gitConnections)
            .where(and(
                eq(schema.gitConnections.userId, userId),
                isNull(schema.gitConnections.revokedAt),
            ));
        return rows.map((r) => this._formatConnection(r));
    }

    async getDecryptedToken(userId, providerName) {
        const cacheKey = tokenCacheKey(userId, providerName);

        // Check cache first to avoid DB SELECT + AES decrypt on every git subcommand.
        const cached = tokenCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            scheduleLastUsedUpdate(cached.connectionId);
            return cached.token;
        }

        const where = [
            eq(schema.gitConnections.userId, userId),
            isNull(schema.gitConnections.revokedAt),
        ];
        if (providerName) {
            where.push(eq(schema.gitConnections.provider, providerName));
        }

        const rows = await db.select().from(schema.gitConnections)
            .where(and(...where));
        if (rows.length === 0) throw new Error(`${providerName || 'git'}_not_connected`);

        const row = rows[0];
        const secrets = auth.decryptSecrets(row.accessTokenEnc);

        // Auto-refresh if token is expiring soon
        let token = secrets.token ?? null;
        if (row.tokenExpiresAt && row.refreshTokenEnc) {
            const expiresIn = row.tokenExpiresAt - Date.now();
            if (expiresIn < 5 * 60 * 1000) {
                try {
                    token = await this._refreshToken(row);
                    // After refresh, cache the new token and return early.
                    tokenCache.set(cacheKey, {
                        token,
                        connectionId: row.id,
                        expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
                    });
                    scheduleLastUsedUpdate(row.id);
                    return token;
                } catch {
                    // Fall through to use existing token
                }
            }
        }

        // Cache the decrypted token so parallel git subcommands don't each hit the DB.
        tokenCache.set(cacheKey, {
            token,
            connectionId: row.id,
            expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
        });

        // Fire-and-forget, throttled per connection.
        scheduleLastUsedUpdate(row.id);

        return token;
    }

    async disconnect(userId, providerName) {
        invalidateTokenCache(userId, providerName);

        const where = [
            eq(schema.gitConnections.userId, userId),
            isNull(schema.gitConnections.revokedAt),
        ];
        if (providerName) {
            where.push(eq(schema.gitConnections.provider, providerName));
        }

        const rows = await db.select().from(schema.gitConnections)
            .where(and(...where));
        if (rows.length === 0) return;

        const now = Date.now();
        for (const row of rows) {
            await db.update(schema.gitConnections)
                .set({ revokedAt: now })
                .where(eq(schema.gitConnections.id, row.id));

            await recordEvent({
                userId,
                subjectType: 'git_connection',
                subjectId: row.id,
                type: 'git.disconnected',
                data: { provider: row.provider },
            });
        }
    }

    async _consumeState(state) {
        if (!state) throw new Error('state is required');
        await this._pruneExpiredStates();

        const rows = await db.select().from(schema.gitOAuthStates)
            .where(eq(schema.gitOAuthStates.state, state));
        if (rows.length === 0) throw new Error('Invalid or expired OAuth state');

        await db.delete(schema.gitOAuthStates)
            .where(eq(schema.gitOAuthStates.state, state));
        return rows[0];
    }

    async _finishConnection(userId, providerName, code) {
        invalidateTokenCache(userId, providerName);
        const config = await getProviderConfig(providerName);
        if (!config) throw new Error(`${providerName} OAuth is not configured`);

        const provider = getProvider(providerName);
        const tokenResult = await provider.exchangeCode(code, {
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            callbackUrl: config.callbackUrl,
            apiBase: config.apiBase,
        });

        const user = await provider.getAuthenticatedUser(tokenResult.accessToken, {
            apiBase: config.apiBase,
        });

        const encrypted = auth.encryptSecrets({ token: tokenResult.accessToken });
        const refreshEnc = tokenResult.refreshToken
            ? auth.encryptSecrets({ token: tokenResult.refreshToken })
            : null;

        const now = Date.now();
        const id = `gitconn_${crypto.randomBytes(8).toString('hex')}`;

        // Remove any prior connections for this user+provider
        await db.delete(schema.gitConnections)
            .where(and(
                eq(schema.gitConnections.userId, userId),
                eq(schema.gitConnections.provider, providerName),
            ));

        const connection = {
            id,
            userId,
            provider: providerName,
            providerConfig: null,
            remoteUserId: user.id,
            remoteUsername: user.username,
            remoteAvatar: user.avatarUrl || null,
            accessTokenEnc: encrypted,
            refreshTokenEnc: refreshEnc,
            tokenScope: tokenResult.scope || config.scope || null,
            tokenExpiresAt: tokenResult.expiresIn
                ? now + tokenResult.expiresIn * 1000
                : null,
            connectedAt: now,
            lastUsedAt: now,
            revokedAt: null,
        };

        await db.insert(schema.gitConnections).values(connection);

        // Also sync to legacy github_connections for backward compat
        if (providerName === 'github') {
            try {
                await db.delete(schema.githubConnections)
                    .where(eq(schema.githubConnections.userId, userId));
                await db.insert(schema.githubConnections).values({
                    id,
                    userId,
                    githubUserId: Number(user.id) || 0,
                    githubUsername: user.username,
                    githubAvatar: user.avatarUrl || null,
                    accessTokenEnc: encrypted,
                    tokenScope: tokenResult.scope || 'repo',
                    connectedAt: now,
                    lastUsedAt: now,
                    revokedAt: null,
                });
            } catch { /* ignore legacy table sync failures */ }
        }

        await recordEvent({
            userId,
            subjectType: 'git_connection',
            subjectId: id,
            type: 'git.connected',
            data: {
                provider: providerName,
                remoteUserId: user.id,
                remoteUsername: user.username,
            },
        });

        return this._formatConnection(connection);
    }

    async _refreshToken(connectionRow) {
        invalidateTokenCache(connectionRow.userId, connectionRow.provider);
        const config = await getProviderConfig(connectionRow.provider);
        if (!config) throw new Error('provider config not found');

        const provider = getProvider(connectionRow.provider);
        const refreshSecrets = auth.decryptSecrets(connectionRow.refreshTokenEnc);

        const result = await provider.refreshAccessToken(refreshSecrets.token, {
            clientId: config.clientId,
            clientSecret: config.clientSecret,
        });

        const now = Date.now();
        const newEnc = auth.encryptSecrets({ token: result.accessToken });
        const newRefreshEnc = result.refreshToken
            ? auth.encryptSecrets({ token: result.refreshToken })
            : connectionRow.refreshTokenEnc;

        await db.update(schema.gitConnections)
            .set({
                accessTokenEnc: newEnc,
                refreshTokenEnc: newRefreshEnc,
                tokenExpiresAt: result.expiresIn ? now + result.expiresIn * 1000 : null,
                lastUsedAt: now,
            })
            .where(eq(schema.gitConnections.id, connectionRow.id));

        return result.accessToken;
    }

    _formatConnection(row) {
        return {
            id: row.id,
            user_id: row.userId,
            provider: row.provider,
            remote_user_id: row.remoteUserId,
            remote_username: row.remoteUsername,
            remote_avatar: row.remoteAvatar,
            token_scope: row.tokenScope,
            connected_at: row.connectedAt,
            last_used_at: row.lastUsedAt,
            // Backward compat for GitHub clients
            github_user_id: row.provider === 'github' ? row.remoteUserId : undefined,
            github_username: row.provider === 'github' ? row.remoteUsername : undefined,
            github_avatar: row.provider === 'github' ? row.remoteAvatar : undefined,
        };
    }

    async _pruneExpiredStates() {
        await db.delete(schema.gitOAuthStates)
            .where(lte(schema.gitOAuthStates.expiresAt, Date.now()));
    }
}

module.exports = { GitConnectionService, getProviderConfig };
