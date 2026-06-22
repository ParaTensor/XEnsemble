const { describe, it, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { GitLabAdapter, GitLabError } = require('./GitLabAdapter');

describe('GitLabAdapter', { concurrency: false }, () => {
    const adapter = new GitLabAdapter();
    const originalFetch = global.fetch;

    after(() => {
        global.fetch = originalFetch;
    });

    beforeEach(() => {
        global.fetch = originalFetch;
    });

    // ── Interface ──

    it('has correct name and displayName', () => {
        assert.strictEqual(adapter.name, 'gitlab');
        assert.strictEqual(adapter.displayName, 'GitLab');
    });

    it('uses Merge Request terminology', () => {
        assert.deepStrictEqual(adapter.prTerminology, {
            singular: 'Merge Request',
            plural: 'Merge Requests',
            abbreviation: 'MR',
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
            scope: 'api read_user',
            apiBase: 'https://gitlab.corp.com',
        });
        const parsed = new URL(url);
        assert.strictEqual(parsed.origin, 'https://gitlab.corp.com');
        assert.strictEqual(parsed.pathname, '/oauth/authorize');
        assert.strictEqual(parsed.searchParams.get('client_id'), 'cid');
        assert.strictEqual(parsed.searchParams.get('state'), 'abc123');
        assert.strictEqual(parsed.searchParams.get('response_type'), 'code');
        assert.strictEqual(parsed.searchParams.get('scope'), 'api read_user');
        assert.strictEqual(parsed.searchParams.get('redirect_uri'), 'https://example.com/cb');
    });

    it('defaults auth URL to gitlab.com', () => {
        const url = adapter.buildAuthUrl({ clientId: 'cid', state: 's' });
        assert.ok(url.startsWith('https://gitlab.com/oauth/authorize'));
    });

    it('exchanges OAuth code for tokens', async () => {
        global.fetch = async (url, opts) => {
            assert.strictEqual(url, 'https://gitlab.com/oauth/token');
            assert.strictEqual(opts.method, 'POST');
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.client_id, 'cid');
            assert.strictEqual(body.code, 'auth-code');
            assert.strictEqual(body.grant_type, 'authorization_code');
            return {
                ok: true,
                json: async () => ({
                    access_token: 'gl_token',
                    refresh_token: 'gl_refresh',
                    expires_in: 7200,
                    scope: 'api',
                }),
            };
        };
        const result = await adapter.exchangeCode('auth-code', { clientId: 'cid', clientSecret: 'cs' });
        assert.strictEqual(result.accessToken, 'gl_token');
        assert.strictEqual(result.refreshToken, 'gl_refresh');
        assert.strictEqual(result.expiresIn, 7200);
    });

    it('throws on OAuth error', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'invalid_grant', error_description: 'Bad grant' }),
        });
        await assert.rejects(adapter.exchangeCode('bad', { clientId: 'c', clientSecret: 's' }), (err) => {
            assert.strictEqual(err.name, 'GitLabError');
            assert.ok(err.message.includes('Bad grant'));
            return true;
        });
    });

    it('refreshes token', async () => {
        global.fetch = async (url, opts) => {
            assert.strictEqual(url, 'https://gitlab.com/oauth/token');
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.grant_type, 'refresh_token');
            assert.strictEqual(body.refresh_token, 'rt');
            return {
                ok: true,
                json: async () => ({ access_token: 'new_token', refresh_token: 'new_rt', expires_in: 7200 }),
            };
        };
        const result = await adapter.refreshAccessToken('rt', { clientId: 'c', clientSecret: 's' });
        assert.strictEqual(result.accessToken, 'new_token');
    });

    // ── User ──

    it('gets authenticated user', async () => {
        global.fetch = async (url, opts) => {
            assert.strictEqual(url, 'https://gitlab.com/api/v4/user');
            assert.strictEqual(opts.headers.Authorization, 'Bearer token');
            return {
                ok: true,
                json: async () => ({ id: 1, username: 'dev', name: 'Dev User', avatar_url: 'https://img', email: 'dev@example.com' }),
            };
        };
        const user = await adapter.getAuthenticatedUser('token');
        assert.strictEqual(user.id, '1');
        assert.strictEqual(user.username, 'dev');
        assert.strictEqual(user.displayName, 'Dev User');
    });

    // ── Repositories ──

    it('lists repos with membership filter', async () => {
        global.fetch = async (url) => {
            const parsed = new URL(url);
            assert.ok(parsed.pathname.endsWith('/api/v4/projects'));
            assert.strictEqual(parsed.searchParams.get('membership'), 'true');
            assert.strictEqual(parsed.searchParams.get('page'), '1');
            return {
                ok: true,
                json: async () => [{
                    id: 42,
                    path_with_namespace: 'group/repo',
                    http_url_to_repo: 'https://gitlab.com/group/repo.git',
                    default_branch: 'main',
                    visibility: 'private',
                    description: 'test repo',
                }],
            };
        };
        const result = await adapter.listUserRepos('token', { page: 1, perPage: 30 });
        assert.strictEqual(result.repos.length, 1);
        assert.strictEqual(result.repos[0].fullName, 'group/repo');
        assert.strictEqual(result.repos[0].private, true);
    });

    it('gets a repo by path', async () => {
        global.fetch = async (url) => {
            assert.ok(url.includes('/api/v4/projects/group%2Frepo'));
            return {
                ok: true,
                json: async () => ({
                    id: 42,
                    path_with_namespace: 'group/repo',
                    http_url_to_repo: 'https://gitlab.com/group/repo.git',
                    default_branch: 'develop',
                    visibility: 'public',
                }),
            };
        };
        const repo = await adapter.getRepo('token', 'group/repo');
        assert.strictEqual(repo.id, '42');
        assert.strictEqual(repo.defaultBranch, 'develop');
    });

    // ── Merge Requests ──

    it('creates a merge request', async () => {
        global.fetch = async (url, opts) => {
            assert.ok(url.includes('/merge_requests'));
            assert.strictEqual(opts.method, 'POST');
            const body = JSON.parse(opts.body);
            assert.strictEqual(body.title, 'MR title');
            assert.strictEqual(body.source_branch, 'feature');
            assert.strictEqual(body.target_branch, 'main');
            return {
                ok: true,
                json: async () => ({
                    iid: 5,
                    web_url: 'https://gitlab.com/group/repo/-/merge_requests/5',
                    title: 'MR title',
                    state: 'opened',
                    source_branch: 'feature',
                    target_branch: 'main',
                }),
            };
        };
        const mr = await adapter.createPR('token', 'group/repo', {
            title: 'MR title',
            body: 'desc',
            head: 'feature',
            base: 'main',
        });
        assert.strictEqual(mr.number, 5);
        assert.strictEqual(mr.state, 'opened');
        assert.strictEqual(mr.merged, false);
    });

    it('gets a merge request', async () => {
        global.fetch = async (url) => {
            assert.ok(url.includes('/merge_requests/5'));
            return {
                ok: true,
                json: async () => ({
                    iid: 5,
                    web_url: 'https://gitlab.com/group/repo/-/merge_requests/5',
                    title: 'MR title',
                    state: 'merged',
                    source_branch: 'feature',
                    target_branch: 'main',
                    merge_commit_sha: 'abc123',
                }),
            };
        };
        const mr = await adapter.getPR('token', 'group/repo', 5);
        assert.strictEqual(mr.number, 5);
        assert.strictEqual(mr.merged, true);
        assert.strictEqual(mr.mergeCommitSha, 'abc123');
    });

    it('lists merge requests with state mapping', async () => {
        global.fetch = async (url) => {
            const parsed = new URL(url);
            assert.strictEqual(parsed.searchParams.get('state'), 'opened');
            return {
                ok: true,
                json: async () => [{ iid: 1, web_url: 'url', title: 't', state: 'opened' }],
            };
        };
        const mrs = await adapter.listPRs('token', 'group/repo', { state: 'open' });
        assert.strictEqual(mrs.length, 1);
    });

    // ── Utility ──

    it('parses nested group repo identifiers', () => {
        const result = adapter.parseRepoIdentifier('group/subgroup/repo');
        assert.strictEqual(result.owner, 'group/subgroup');
        assert.strictEqual(result.repo, 'repo');
    });

    it('builds clone URL', () => {
        const url = adapter.buildCloneUrl('group/repo');
        assert.strictEqual(url, 'https://gitlab.com/group/repo.git');
    });

    it('builds clone URL with custom base', () => {
        const url = adapter.buildCloneUrl('group/repo', { apiBase: 'https://gitlab.corp.com/api/v4' });
        assert.strictEqual(url, 'https://gitlab.corp.com/group/repo.git');
    });

    // ── Error handling ──

    it('throws GitLabError on API error', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 404,
            json: async () => ({ message: 'Not found' }),
        });
        await assert.rejects(adapter.getRepo('token', 'group/missing'), (err) => {
            assert.strictEqual(err.name, 'GitLabError');
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
