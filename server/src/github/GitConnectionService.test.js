const crypto = require('crypto');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { eq, and, inArray } = require('drizzle-orm');
const { bootstrapTestDb } = require('../test/db');

let ctx;
let db;
let schema;
let userAdmin;
let platformSettings;
let GitConnectionService;

describe('GitConnectionService', { concurrency: false }, () => {
    let userId;
    let otherUserId;
    let service;

    before(async () => {
        ctx = await bootstrapTestDb([
            '../db/index',
            '../admin/UserAdminService',
            '../admin/PlatformSettings',
            '../github/GitConnectionService',
        ], __dirname);
        ({ db, schema } = ctx);
        userAdmin = ctx.reloaded['../admin/UserAdminService'];
        platformSettings = ctx.reloaded['../admin/PlatformSettings'];
        ({ GitConnectionService } = ctx.reloaded['../github/GitConnectionService']);

        await platformSettings.set('GITHUB_CLIENT_ID', 'test-client-id');
        await platformSettings.set('GITHUB_CALLBACK_URL', 'http://localhost/callback');

        const suffix = Date.now();
        const u1 = await userAdmin.createUser(
            { username: `ghconn_user_${suffix}`, password: 'Password1!' },
            null,
        );
        userId = u1.id;

        const u2 = await userAdmin.createUser(
            { username: `ghconn_other_${suffix}`, password: 'Password1!' },
            null,
        );
        otherUserId = u2.id;

        service = createService();
    });

    after(async () => {
        await db.delete(schema.githubConnections).where(eq(schema.githubConnections.userId, userId));
        await db.delete(schema.githubConnections).where(eq(schema.githubConnections.userId, otherUserId));
        await db.delete(schema.githubOAuthStates).where(eq(schema.githubOAuthStates.userId, userId));
        await db.delete(schema.githubOAuthStates).where(eq(schema.githubOAuthStates.userId, otherUserId));
        await db.delete(schema.events).where(eq(schema.events.userId, userId));
        await db.delete(schema.events).where(eq(schema.events.userId, otherUserId));
        await db.delete(schema.userQuotas).where(eq(schema.userQuotas.userId, userId));
        await db.delete(schema.userQuotas).where(eq(schema.userQuotas.userId, otherUserId));
        await db.delete(schema.userAgentGrants).where(eq(schema.userAgentGrants.userId, userId));
        await db.delete(schema.userAgentGrants).where(eq(schema.userAgentGrants.userId, otherUserId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        await db.delete(schema.users).where(eq(schema.users.id, otherUserId));
        await db.delete(schema.platformSettings).where(
            inArray(schema.platformSettings.key, ['GITHUB_CLIENT_ID', 'GITHUB_CALLBACK_URL']),
        );
        if (ctx) await ctx.teardown();
    });

    function createService() {
        return new GitConnectionService({
            async exchangeOAuthCode() {
                return 'gho_plaintext_token';
            },
            async getAuthenticatedUser() {
                return {
                    id: 42,
                    login: 'octocat',
                    avatar_url: 'https://example.com/avatar.png',
                };
            },
        });
    }

    it('initiateOAuth creates a state and returns a GitHub auth URL', async () => {
        const { authUrl, state } = await service.initiateOAuth(userId);

        assert.match(state, /^[0-9a-f]{32}$/);

        const parsed = new URL(authUrl);
        assert.strictEqual(parsed.hostname, 'github.com');
        assert.strictEqual(parsed.pathname, '/login/oauth/authorize');
        assert.strictEqual(parsed.searchParams.get('client_id'), 'test-client-id');
        assert.strictEqual(parsed.searchParams.get('state'), state);
        assert.strictEqual(parsed.searchParams.get('scope'), 'repo');
        assert.strictEqual(parsed.searchParams.get('redirect_uri'), 'http://localhost/callback');

        const rows = await db
            .select()
            .from(schema.githubOAuthStates)
            .where(eq(schema.githubOAuthStates.state, state));
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].userId, userId);
        assert.ok(rows[0].expiresAt > Date.now());
        assert.ok(rows[0].expiresAt <= Date.now() + 5 * 60 * 1000);
    });

    it('completeOAuthFromCallback finishes a connection from stored state', async () => {
        const { state } = await service.initiateOAuth(userId);
        const conn = await service.completeOAuthFromCallback('auth-code', state);

        assert.ok(conn.id.startsWith('ghconn_'));
        assert.strictEqual(conn.user_id, userId);
        assert.strictEqual(conn.github_user_id, 42);
        assert.strictEqual(conn.github_username, 'octocat');
        assert.strictEqual(conn.token_scope, 'repo');
        assert.strictEqual(conn.revoked_at, undefined);

        const stored = await service.getConnection(userId);
        assert.ok(stored);
        assert.strictEqual(stored.id, conn.id);

        const token = await service.getDecryptedToken(userId);
        assert.strictEqual(token, 'gho_plaintext_token');

        const events = await db
            .select()
            .from(schema.events)
            .where(and(eq(schema.events.userId, userId), eq(schema.events.type, 'github.connected')));
        assert.strictEqual(events.length, 1);
    });

    it('completeOAuthFromDesktop rejects a state bound to a different user', async () => {
        await service.disconnect(userId);
        assert.strictEqual(await service.getConnection(userId), null);

        const { state } = await service.initiateOAuth(otherUserId);

        await assert.rejects(
            service.completeOAuthFromDesktop(userId, 'auth-code', state),
            (err) => {
                assert.ok(err.message.includes('does not match'));
                return true;
            },
        );

        assert.strictEqual(await service.getConnection(userId), null);

        // Remove events produced by the defensive disconnect so the next test
        // starts with a clean audit log.
        await db.delete(schema.events).where(eq(schema.events.userId, userId));
    });

    it('disconnect revokes the active connection and records an event', async () => {
        const { state } = await service.initiateOAuth(userId);
        const conn = await service.completeOAuthFromCallback('auth-code', state);

        await service.disconnect(userId);

        assert.strictEqual(await service.getConnection(userId), null);

        const rows = await db
            .select()
            .from(schema.githubConnections)
            .where(eq(schema.githubConnections.id, conn.id));
        assert.strictEqual(rows.length, 1);
        assert.ok(rows[0].revokedAt);

        const events = await db
            .select()
            .from(schema.events)
            .where(and(
                eq(schema.events.userId, userId),
                eq(schema.events.type, 'github.disconnected'),
                eq(schema.events.subjectId, conn.id),
            ));
        assert.strictEqual(events.length, 1);
    });

    it('rejects an expired OAuth state', async () => {
        const expiredState = crypto.randomBytes(16).toString('hex');
        await db.insert(schema.githubOAuthStates).values({
            state: expiredState,
            userId,
            expiresAt: Date.now() - 1000,
        });

        await assert.rejects(
            service.completeOAuthFromCallback('auth-code', expiredState),
            (err) => {
                assert.ok(err.message.includes('Invalid or expired'));
                return true;
            },
        );
    });

    it('does not store the raw token in the database', async () => {
        const { state } = await service.initiateOAuth(userId);
        const conn = await service.completeOAuthFromCallback('auth-code', state);

        const rows = await db
            .select()
            .from(schema.githubConnections)
            .where(eq(schema.githubConnections.id, conn.id));
        assert.strictEqual(rows.length, 1);
        assert.notStrictEqual(rows[0].accessTokenEnc, 'gho_plaintext_token');
    });

    it('stores tokenScope as repo', async () => {
        const { state } = await service.initiateOAuth(userId);
        const conn = await service.completeOAuthFromCallback('auth-code', state);

        assert.strictEqual(conn.token_scope, 'repo');

        const rows = await db
            .select()
            .from(schema.githubConnections)
            .where(eq(schema.githubConnections.id, conn.id));
        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0].tokenScope, 'repo');
    });
});
