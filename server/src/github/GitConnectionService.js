const crypto = require('crypto');
const { eq, and, isNull, lte } = require('drizzle-orm');

const { db } = require('../db/index');
const schema = require('../db/schema');
const auth = require('../auth/index');
const { recordEvent } = require('../events/recordEvent');
const PlatformSettings = require('../admin/PlatformSettings');
const { GitHubService } = require('./GitHubService');

const STATE_TTL_MS = 5 * 60 * 1000;

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

        const state = `ghstate_${crypto.randomBytes(8).toString('hex')}`;
        const expiresAt = Date.now() + STATE_TTL_MS;

        await db.insert(schema.githubOAuthStates).values({
            state,
            userId,
            expiresAt,
        });

        const params = new URLSearchParams({
            client_id: String(clientId),
            state,
            scope: 'repo,user:email',
        });

        const redirectUri = await PlatformSettings.get('GITHUB_CALLBACK_URL');
        if (redirectUri) {
            params.set('redirect_uri', String(redirectUri));
        }

        return {
            authUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
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

        const row = rows[0];
        const secrets = auth.decryptSecrets(row.accessTokenEnc);

        await db
            .update(schema.githubConnections)
            .set({ lastUsedAt: Date.now() })
            .where(eq(schema.githubConnections.id, row.id));

        return secrets.token ?? null;
    }

    async disconnect(userId) {
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
        const token = await this.gitHubService.exchangeOAuthCode(code);
        const ghUser = await this.gitHubService.getAuthenticatedUser(token);

        const encrypted = auth.encryptSecrets({ token });
        const now = Date.now();

        const existing = await db
            .select()
            .from(schema.githubConnections)
            .where(eq(schema.githubConnections.userId, userId));

        const id = existing.length > 0
            ? existing[0].id
            : `ghconn_${crypto.randomBytes(8).toString('hex')}`;

        const connection = {
            id,
            userId,
            githubUserId: ghUser.id,
            githubUsername: ghUser.login,
            githubAvatar: ghUser.avatar_url || null,
            accessTokenEnc: encrypted,
            tokenScope: null,
            connectedAt: existing.length > 0 ? existing[0].connectedAt : now,
            lastUsedAt: now,
            revokedAt: null,
        };

        if (existing.length > 0) {
            await db
                .update(schema.githubConnections)
                .set(connection)
                .where(eq(schema.githubConnections.id, id));
        } else {
            await db.insert(schema.githubConnections).values(connection);
        }

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
            userId: row.userId,
            githubUserId: row.githubUserId,
            githubUsername: row.githubUsername,
            githubAvatar: row.githubAvatar,
            tokenScope: row.tokenScope,
            connectedAt: row.connectedAt,
            lastUsedAt: row.lastUsedAt,
            revokedAt: row.revokedAt,
        };
    }

    async _pruneExpiredStates() {
        await db
            .delete(schema.githubOAuthStates)
            .where(lte(schema.githubOAuthStates.expiresAt, Date.now()));
    }
}

module.exports = { GitConnectionService };
