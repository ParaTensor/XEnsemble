const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const settingsPath = require.resolve('../admin/PlatformSettings');
const secretsPath = require.resolve('../admin/PlatformSecrets');

const originalSettingsModule = require.cache[settingsPath];
const originalSecretsModule = require.cache[secretsPath];
const originalFetch = global.fetch;

const mockSettings = {
    async get(key) {
        if (key === 'GITHUB_API_BASE') return 'https://api.github.com';
        if (key === 'GITHUB_CLIENT_ID') return 'test-client-id';
        if (key === 'GITHUB_CLIENT_SECRET') return 'encrypted-secret';
        return null;
    },
};

const mockSecrets = {
    getPlatformSecret() {
        return 'test-client-secret';
    },
};

require.cache[settingsPath] = {
    id: settingsPath,
    filename: settingsPath,
    loaded: true,
    exports: mockSettings,
};

require.cache[secretsPath] = {
    id: secretsPath,
    filename: secretsPath,
    loaded: true,
    exports: mockSecrets,
};

const service = require('./GitHubService');

describe('GitHubService', { concurrency: false }, () => {
    after(() => {
        global.fetch = originalFetch;
        if (originalSettingsModule) {
            require.cache[settingsPath] = originalSettingsModule;
        } else {
            delete require.cache[settingsPath];
        }
        if (originalSecretsModule) {
            require.cache[secretsPath] = originalSecretsModule;
        } else {
            delete require.cache[secretsPath];
        }
        delete require.cache[require.resolve('./GitHubService')];
    });

    it('exchanges OAuth code and returns access_token', async () => {
        global.fetch = async (url, options) => {
            assert.strictEqual(url, 'https://github.com/login/oauth/access_token');
            assert.strictEqual(options.method, 'POST');
            const body = JSON.parse(options.body);
            assert.strictEqual(body.client_id, 'test-client-id');
            assert.strictEqual(body.client_secret, 'test-client-secret');
            assert.strictEqual(body.code, 'auth-code');
            return {
                ok: true,
                json: async () => ({ access_token: 'gho_token123', scope: 'repo', token_type: 'bearer' }),
            };
        };
        const token = await service.exchangeOAuthCode('auth-code');
        assert.strictEqual(token, 'gho_token123');
    });

    it('throws on OAuth error response', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'bad_verification_code', error_description: 'Bad code' }),
        });
        await assert.rejects(service.exchangeOAuthCode('bad-code'), (err) => {
            assert.strictEqual(err.code, 'bad_verification_code');
            assert.strictEqual(err.message, 'Bad code');
            return true;
        });
    });

    it('throws not_configured when OAuth credentials are missing', async () => {
        const prevGet = mockSettings.get;
        mockSettings.get = async () => null;
        try {
            await assert.rejects(service.exchangeOAuthCode('code'), (err) => {
                assert.strictEqual(err.code, 'not_configured');
                return true;
            });
        } finally {
            mockSettings.get = prevGet;
        }
    });

    it('maps 401 to token_expired', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 401,
            json: async () => ({ message: 'Bad credentials' }),
        });
        await assert.rejects(service.getAuthenticatedUser('bad-token'), (err) => {
            assert.strictEqual(err.code, 'token_expired');
            assert.strictEqual(err.status, 401);
            return true;
        });
    });

    it('maps 403 to insufficient_scope', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 403,
            json: async () => ({ message: 'Forbidden' }),
        });
        await assert.rejects(service.getRepo('token', 'owner', 'repo'), (err) => {
            assert.strictEqual(err.code, 'insufficient_scope');
            assert.strictEqual(err.status, 403);
            return true;
        });
    });

    it('maps 404 to repo_not_found', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 404,
            json: async () => ({ message: 'Not Found' }),
        });
        await assert.rejects(service.getRepo('token', 'owner', 'missing'), (err) => {
            assert.strictEqual(err.code, 'repo_not_found');
            assert.strictEqual(err.status, 404);
            return true;
        });
    });

    it('creates a pull request with correct payload and headers', async () => {
        global.fetch = async (url, options) => {
            assert.strictEqual(url, 'https://api.github.com/repos/owner/repo/pulls');
            assert.strictEqual(options.method, 'POST');
            assert.strictEqual(options.headers.Authorization, 'Bearer token');
            assert.strictEqual(options.headers.Accept, 'application/vnd.github+json');
            assert.strictEqual(options.headers['X-GitHub-Api-Version'], '2022-11-28');
            const body = JSON.parse(options.body);
            assert.deepStrictEqual(body, { title: 'PR title', body: 'PR body', head: 'feature', base: 'main' });
            return {
                ok: true,
                json: async () => ({ number: 42, title: 'PR title' }),
            };
        };
        const pr = await service.createPullRequest('token', 'owner', 'repo', {
            title: 'PR title',
            body: 'PR body',
            head: 'feature',
            base: 'main',
        });
        assert.strictEqual(pr.number, 42);
    });

    it('lists pull requests with query params', async () => {
        global.fetch = async (url) => {
            assert.ok(url.startsWith('https://api.github.com/repos/owner/repo/pulls'));
            const parsed = new URL(url);
            assert.strictEqual(parsed.searchParams.get('state'), 'open');
            assert.strictEqual(parsed.searchParams.get('page'), '1');
            assert.strictEqual(parsed.searchParams.get('per_page'), '10');
            return {
                ok: true,
                json: async () => [{ number: 1 }],
            };
        };
        const prs = await service.listPullRequests('token', 'owner', 'repo', { state: 'open', page: 1, perPage: 10 });
        assert.strictEqual(prs.length, 1);
        assert.strictEqual(prs[0].number, 1);
    });

    it('revokeToken returns true as a Phase 1 stub', async () => {
        const result = await service.revokeToken('token');
        assert.strictEqual(result, true);
    });

    it('getAuthenticatedUser returns normalized user', async () => {
        global.fetch = async (url, options) => {
            assert.strictEqual(url, 'https://api.github.com/user');
            assert.strictEqual(options.headers.Authorization, 'Bearer token');
            return {
                ok: true,
                json: async () => ({ id: 123, login: 'octocat', avatar_url: 'https://example.com/avatar.png' }),
            };
        };
        const user = await service.getAuthenticatedUser('token');
        assert.deepStrictEqual(user, { id: 123, login: 'octocat', avatar_url: 'https://example.com/avatar.png' });
    });

    it('listUserRepos returns repos with query params', async () => {
        global.fetch = async (url) => {
            assert.ok(url.startsWith('https://api.github.com/user/repos'));
            const parsed = new URL(url);
            assert.strictEqual(parsed.searchParams.get('page'), '1');
            assert.strictEqual(parsed.searchParams.get('per_page'), '10');
            assert.strictEqual(parsed.searchParams.get('affiliation'), 'owner');
            assert.strictEqual(parsed.searchParams.get('sort'), 'updated');
            return {
                ok: true,
                json: async () => [{ id: 1, name: 'repo' }],
            };
        };
        const repos = await service.listUserRepos('token', { page: 1, perPage: 10, affiliation: 'owner' });
        assert.strictEqual(repos.length, 1);
        assert.strictEqual(repos[0].name, 'repo');
    });

    it('getRepo returns repository data', async () => {
        global.fetch = async (url, options) => {
            assert.strictEqual(url, 'https://api.github.com/repos/owner/repo');
            assert.strictEqual(options.headers.Authorization, 'Bearer token');
            return {
                ok: true,
                json: async () => ({ id: 42, full_name: 'owner/repo' }),
            };
        };
        const repo = await service.getRepo('token', 'owner', 'repo');
        assert.strictEqual(repo.full_name, 'owner/repo');
    });

    it('getPullRequest returns pull request data', async () => {
        global.fetch = async (url, options) => {
            assert.strictEqual(url, 'https://api.github.com/repos/owner/repo/pulls/7');
            assert.strictEqual(options.headers.Authorization, 'Bearer token');
            return {
                ok: true,
                json: async () => ({ number: 7, title: 'Fix bug' }),
            };
        };
        const pr = await service.getPullRequest('token', 'owner', 'repo', 7);
        assert.strictEqual(pr.number, 7);
    });

    it('throws oauth_error when OAuth response lacks access_token', async () => {
        global.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({ scope: 'repo', token_type: 'bearer' }),
        });
        await assert.rejects(service.exchangeOAuthCode('code'), (err) => {
            assert.strictEqual(err.code, 'oauth_error');
            assert.strictEqual(err.message, 'OAuth response did not contain an access token');
            return true;
        });
    });

    it('handles non-JSON error bodies from GitHub API', async () => {
        global.fetch = async () => ({
            ok: false,
            status: 500,
            json: async () => { throw new Error('invalid json'); },
        });
        await assert.rejects(service.getRepo('token', 'owner', 'repo'), (err) => {
            assert.strictEqual(err.code, 'github_api_error');
            assert.strictEqual(err.status, 500);
            assert.ok(err.message.includes('getRepo failed with status 500'));
            return true;
        });
    });

    it('throws network_error when fetch fails', async () => {
        global.fetch = async () => { throw new Error('net::ERR_FAILED'); };
        await assert.rejects(service.getAuthenticatedUser('token'), (err) => {
            assert.strictEqual(err.code, 'network_error');
            assert.ok(err.message.includes('GitHub request failed'));
            return true;
        });
    });
});
