const { describe, it, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { GiteaAdapter, GiteaError } = require('./GiteaAdapter');

describe('GiteaAdapter', { concurrency: false }, () => {
    const adapter = new GiteaAdapter();
    const originalFetch = global.fetch;

    after(() => {
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        global.fetch = originalFetch;
    });

    // ── Interface ──

    it('has correct name and displayName', () => {
        assert.strictEqual(adapter.name, 'gitea');
        assert.strictEqual(adapter.displayName, 'Gitea');
    });

    it('uses Pull Request terminology', () => {
        assert.deepStrictEqual(adapter.prTerminology, {
            singular: 'Pull Request',
            plural: 'Pull Requests',
            abbreviation: 'PR',
        });
    });

    it('requiresTokenRefresh is true', () => {
        assert.strictEqual(adapter.requiresTokenRefresh, true);
    });

    // ── OAuth ──

    it('builds auth URL with correct params', () => {
        const url = adapter.buildAuthUrl({
            clientId: 'cid',
            callbackUrl: 'https://example.com/cb',
            state: 'abc123',
            apiBase: 'https://gitea.corp.com',
        });
        const parsed = new URL(url);
        assert.strictEqual(parsed.origin, 'https://gitea.corp.com');
        assert.strictEqual(parsed.pathname, '/login/oauth/authorize');
        assert.strictEqual(parsed.searchParams.get('client_id'), 'cid');
        assert.strictEqual(parsed.searchParams.get('state'), 'abc123');
        assert.strictEqual(parsed.searchParams.get('response_type'), 'code');
    });

    it('defaults auth URL to gitea.com', () => {
        const url = adapter.buildAuthUrl({ clientId: 'cid', state: 's' });
        assert.ok(url.startsWith('https://gitea.com/login/oauth/authorize'));
    });

    it('exchanges OAuth code for tokens', async () => {
        global.fetch = async (url, opts) => {
            assert.strictEqual(url, 'https://gitea.com/login/oauth/access_token');
            assert.strictEqual(opts.method, 'POST');
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.client_id, 'cid');
            assert.strictEqual(body.code, 'auth-code');
            assert.strictEqual(body.grant_type, 'authorization_code');
            return {
                ok: true,
                json: async () => ({
                    access_token: 'gt_token',
                    refresh_token: 'gt_refresh',
                    expires_in: 3600,
                }),
            };
        };
        const result = await adapter.exchangeCode('auth-code', { clientId: 'cid', clientSecret: 'cs' });
        assert.strictEqual(result.accessToken, 'gt_token');
        assert.strictEqual(result.refreshToken, 'gt_refresh');
        assert.strictEqual(result.expiresIn, 3600);
    });

    it('throws on OAuth error', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'invalid_grant', error_description: 'Bad grant' }),
        });
        await assert.rejects(adapter.exchangeCode('bad', { clientId: 'c', clientSecret: 's' }), (err) => {
            assert.strictEqual(err.name, 'GiteaError');
            assert.ok(err.message.includes('Bad grant'));
            return true;
        });
    });

    it('refreshes token', async () => {
        global.fetch = async (url, opts) => {
            assert.strictEqual(url, 'https://gitea.com/login/oauth/access_token');
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.grant_type, 'refresh_token');
            assert.strictEqual(body.refresh_token, 'rt');
            return {
                ok: true,
                json: async () => ({ access_token: 'new_token', refresh_token: 'new_rt', expires_in: 3600 }),
            };
        };
        const result = await adapter.refreshAccessToken('rt', { clientId: 'c', clientSecret: 's' });
        assert.strictEqual(result.accessToken, 'new_token');
    });

    // ── User ──

    it('gets authenticated user', async () => {
        global.fetch = async (url, opts) => {
            assert.strictEqual(url, 'https://gitea.com/api/v1/user');
            assert.strictEqual(opts.headers.Authorization, 'token tk');
            return {
                ok: true,
                text: async () => JSON.stringify({ id: 1, login: 'dev', full_name: 'Dev User', avatar_url: 'https://img', email: 'dev@e.com' }),
            };
        };
        const user = await adapter.getAuthenticatedUser('tk');
        assert.strictEqual(user.id, '1');
        assert.strictEqual(user.username, 'dev');
        assert.strictEqual(user.displayName, 'Dev User');
    });

    it('uses token auth header (not Bearer)', async () => {
        global.fetch = async (url, opts) => {
            assert.strictEqual(opts.headers.Authorization, 'token mytoken');
            return { ok: true, text: async () => JSON.stringify({ id: 1, login: 'u' }) };
        };
        await adapter.getAuthenticatedUser('mytoken');
    });

    // ── Repositories ──

    it('lists repos with limit param', async () => {
        global.fetch = async (url) => {
            const parsed = new URL(url);
            assert.ok(parsed.pathname.endsWith('/api/v1/user/repos'));
            assert.strictEqual(parsed.searchParams.get('limit'), '30');
            assert.strictEqual(parsed.searchParams.get('sort'), 'updated');
            return {
                ok: true,
                text: async () => JSON.stringify([{
                    id: 42,
                    full_name: 'owner/repo',
                    clone_url: 'https://gitea.com/owner/repo.git',
                    default_branch: 'main',
                    private: false,
                }]),
            };
        };
        const result = await adapter.listUserRepos('token', { page: 1, perPage: 30 });
        assert.strictEqual(result.repos.length, 1);
        assert.strictEqual(result.repos[0].fullName, 'owner/repo');
    });

    it('gets a repo', async () => {
        global.fetch = async (url) => {
            assert.ok(url.includes('/repos/owner/repo'));
            return {
                ok: true,
                text: async () => JSON.stringify({
                    id: 42,
                    full_name: 'owner/repo',
                    clone_url: 'https://gitea.com/owner/repo.git',
                    default_branch: 'develop',
                }),
            };
        };
        const repo = await adapter.getRepo('token', 'owner/repo');
        assert.strictEqual(repo.id, '42');
        assert.strictEqual(repo.defaultBranch, 'develop');
    });

    // ── Pull Requests ──

    it('creates a pull request', async () => {
        global.fetch = async (url, opts) => {
            assert.ok(url.includes('/repos/owner/repo/pulls'));
            assert.strictEqual(opts.method, 'POST');
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.title, 'PR title');
            assert.strictEqual(body.head, 'feature');
            assert.strictEqual(body.base, 'main');
            return {
                ok: true,
                text: async () => JSON.stringify({
                    number: 3,
                    html_url: 'https://gitea.com/owner/repo/pulls/3',
                    title: 'PR title',
                    state: 'open',
                    head: { ref: 'feature' },
                    base: { ref: 'main' },
                }),
            };
        };
        const pr = await adapter.createPR('token', 'owner/repo', {
            title: 'PR title',
            body: 'desc',
            head: 'feature',
            base: 'main',
        });
        assert.strictEqual(pr.number, 3);
        assert.strictEqual(pr.state, 'open');
    });

    it('gets a pull request', async () => {
        global.fetch = async (url) => {
            assert.ok(url.includes('/pulls/3'));
            return {
                ok: true,
                text: async () => JSON.stringify({
                    number: 3,
                    html_url: 'url',
                    title: 'PR',
                    state: 'open',
                    merged: false,
                }),
            };
        };
        const pr = await adapter.getPR('token', 'owner/repo', 3);
        assert.strictEqual(pr.number, 3);
    });

    it('lists pull requests', async () => {
        global.fetch = async (url) => {
            const parsed = new URL(url);
            assert.strictEqual(parsed.searchParams.get('state'), 'open');
            assert.strictEqual(parsed.searchParams.get('limit'), '10');
            return {
                ok: true,
                text: async () => JSON.stringify([{ number: 1, html_url: 'url', title: 't', state: 'open' }]),
            };
        };
        const prs = await adapter.listPRs('token', 'owner/repo', { state: 'open', perPage: 10 });
        assert.strictEqual(prs.length, 1);
    });

    // ── Utility ──

    it('parses repo identifier', () => {
        const result = adapter.parseRepoIdentifier('owner/repo');
        assert.strictEqual(result.owner, 'owner');
        assert.strictEqual(result.repo, 'repo');
    });

    it('rejects nested paths (Gitea uses owner/repo only)', () => {
        assert.throws(() => adapter.parseRepoIdentifier('a/b/c'), /Invalid Gitea repo/);
    });

    it('builds clone URL', () => {
        const url = adapter.buildCloneUrl('owner/repo');
        assert.strictEqual(url, 'https://gitea.com/owner/repo.git');
    });

    it('builds clone URL with custom base', () => {
        const url = adapter.buildCloneUrl('owner/repo', { apiBase: 'https://gitea.corp.com/api/v1' });
        assert.strictEqual(url, 'https://gitea.corp.com/owner/repo.git');
    });

    // ── Error handling ──

    it('throws GiteaError on API error', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 404,
            json: async () => ({ message: 'Not found' }),
        });
        await assert.rejects(adapter.getRepo('token', 'owner/missing'), (err) => {
            assert.strictEqual(err.name, 'GiteaError');
            assert.strictEqual(err.code, 'repo_not_found');
            assert.strictEqual(err.status, 404);
            return true;
        });
    });

    it('throws on network error', async () => {
        global.fetch = async () => { throw new Error('network fail'); };
        await assert.rejects(adapter.getAuthenticatedUser('token'), (err) => {
            assert.strictEqual(err.code, 'network_error');
            return true;
        });
    });
});
