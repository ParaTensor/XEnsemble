const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { buildJWT, verifyWebhookSignature, GitHubAppService } = require('./GitHubAppService');

// ── Helper: generate RSA key pair for testing ──

const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function base64urlDecode(str) {
    const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseJWT(token) {
    const parts = token.split('.');
    return {
        header: JSON.parse(base64urlDecode(parts[0]).toString()),
        payload: JSON.parse(base64urlDecode(parts[1]).toString()),
        signature: parts[2],
    };
}

// ── buildJWT ──

describe('buildJWT', () => {
    it('produces a valid RS256 JWT with correct claims', () => {
        const now = Math.floor(Date.now() / 1000);
        const jwt = buildJWT('12345', TEST_PRIVATE_KEY, now);

        const parts = jwt.split('.');
        assert.strictEqual(parts.length, 3, 'JWT should have 3 parts');

        const decoded = parseJWT(jwt);
        assert.strictEqual(decoded.header.alg, 'RS256');
        assert.strictEqual(decoded.header.typ, 'JWT');
        assert.strictEqual(decoded.payload.iss, '12345');
        assert.strictEqual(decoded.payload.iat, now - 60);
        assert.strictEqual(decoded.payload.exp, now + 600);
    });

    it('JWT signature is verifiable with the public key', () => {
        const now = Math.floor(Date.now() / 1000);
        const jwt = buildJWT('99', TEST_PRIVATE_KEY, now);
        const parts = jwt.split('.');
        const sigInput = `${parts[0]}.${parts[1]}`;
        const sigBuf = base64urlDecode(parts[2]);

        const verify = crypto.createVerify('RSA-SHA256');
        verify.update(sigInput);
        assert.ok(verify.verify(TEST_PUBLIC_KEY, sigBuf), 'Signature should verify with public key');
    });

    it('iss is always a string', () => {
        const now = Math.floor(Date.now() / 1000);
        const jwt = buildJWT(42, TEST_PRIVATE_KEY, now);
        const decoded = parseJWT(jwt);
        assert.strictEqual(decoded.payload.iss, '42');
    });
});

// ── verifyWebhookSignature ──

describe('verifyWebhookSignature', () => {
    const secret = 'test_webhook_secret_123';
    const payload = JSON.stringify({ action: 'opened', number: 1 });

    it('returns true for a valid HMAC-SHA256 signature', () => {
        const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
        assert.ok(verifyWebhookSignature(payload, sig, secret));
    });

    it('returns false for an invalid signature', () => {
        assert.ok(!verifyWebhookSignature(payload, 'sha256=deadbeef', secret));
    });

    it('returns false when signature header is missing', () => {
        assert.ok(!verifyWebhookSignature(payload, null, secret));
    });

    it('returns false when secret is missing', () => {
        const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
        assert.ok(!verifyWebhookSignature(payload, sig, null));
    });

    it('returns false for tampered payload', () => {
        const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
        assert.ok(!verifyWebhookSignature(payload + 'x', sig, secret));
    });
});

// ── GitHubAppService (with mocked deps) ──

function mockConfig(overrides = {}) {
    return {
        appId: '12345',
        privateKey: TEST_PRIVATE_KEY,
        webhookSecret: 'wh_secret_test',
        apiBase: 'https://api.github.com',
        ...overrides,
    };
}

function mockFetch(handler) {
    return async (url, opts) => {
        const result = handler(url, opts);
        return {
            ok: result.ok !== false,
            status: result.status || (result.ok === false ? 500 : 200),
            json: async () => result.body,
        };
    };
}

describe('GitHubAppService', () => {
    describe('generateJWT', () => {
        it('generates a valid JWT when configured', async () => {
            const service = new GitHubAppService({
                getConfig: async () => mockConfig(),
            });
            const jwt = await service.generateJWT();
            const decoded = parseJWT(jwt);
            assert.strictEqual(decoded.payload.iss, '12345');
        });

        it('throws when not configured', async () => {
            const service = new GitHubAppService({
                getConfig: async () => null,
            });
            await assert.rejects(() => service.generateJWT(), { statusCode: 503 });
        });

        it('throws when private key is missing', async () => {
            const service = new GitHubAppService({
                getConfig: async () => ({ appId: '1', privateKey: null }),
            });
            await assert.rejects(() => service.generateJWT(), { statusCode: 503 });
        });
    });

    describe('getInstallationToken', () => {
        it('exchanges installation ID for a token', async () => {
            const expiresAt = new Date(Date.now() + 3600000).toISOString();
            const service = new GitHubAppService({
                getConfig: async () => mockConfig(),
                fetch: mockFetch((url) => {
                    if (url.includes('/app/installations/999/access_tokens')) {
                        return { body: { token: 'ghs_test_token', expires_at: expiresAt } };
                    }
                    return { ok: false, status: 404, body: { message: 'Not found' } };
                }),
            });

            // Disable cache by mocking _getCachedToken
            service._getCachedToken = async () => null;
            service._cacheToken = async () => {};

            const result = await service.getInstallationToken(999);
            assert.strictEqual(result.token, 'ghs_test_token');
            assert.ok(result.expiresAt > Date.now());
        });

        it('throws on API failure', async () => {
            const service = new GitHubAppService({
                getConfig: async () => mockConfig(),
                fetch: mockFetch(() => ({
                    ok: false,
                    status: 401,
                    body: { message: 'Bad credentials' },
                })),
            });
            service._getCachedToken = async () => null;

            await assert.rejects(() => service.getInstallationToken(999), (err) => {
                assert.ok(err.message.includes('Bad credentials'));
                return true;
            });
        });

        it('returns cached token if still valid', async () => {
            let fetchCalled = false;
            const service = new GitHubAppService({
                getConfig: async () => mockConfig(),
                fetch: mockFetch(() => { fetchCalled = true; return { body: {} }; }),
            });
            service._getCachedToken = async () => ({
                token: 'cached_token',
                expiresAt: Date.now() + 3600000,
            });

            const result = await service.getInstallationToken(999);
            assert.strictEqual(result.token, 'cached_token');
            assert.ok(!fetchCalled, 'Should not call fetch when cache is valid');
        });
    });

    describe('listInstallations', () => {
        it('returns normalized installation list', async () => {
            const service = new GitHubAppService({
                getConfig: async () => mockConfig(),
                fetch: mockFetch((url) => {
                    if (url.includes('/app/installations')) {
                        return {
                            body: [
                                {
                                    id: 100,
                                    account: { login: 'test-org', type: 'Organization', avatar_url: 'https://a.com/img.png' },
                                    target_type: 'Organization',
                                    permissions: { pull_requests: 'write', contents: 'read' },
                                    events: ['pull_request', 'push'],
                                    repository_selection: 'selected',
                                    created_at: '2025-01-01T00:00:00Z',
                                    updated_at: '2025-06-01T00:00:00Z',
                                },
                            ],
                        };
                    }
                    return { ok: false, status: 404, body: {} };
                }),
            });

            const installations = await service.listInstallations();
            assert.strictEqual(installations.length, 1);
            assert.strictEqual(installations[0].id, 100);
            assert.strictEqual(installations[0].account.login, 'test-org');
            assert.strictEqual(installations[0].account.type, 'Organization');
            assert.strictEqual(installations[0].repositorySelection, 'selected');
        });
    });

    describe('listInstallationRepos', () => {
        it('lists repos for an installation', async () => {
            const expiresAt = new Date(Date.now() + 3600000).toISOString();
            const service = new GitHubAppService({
                getConfig: async () => mockConfig(),
                fetch: mockFetch((url) => {
                    if (url.includes('/access_tokens')) {
                        return { body: { token: 'ghs_tok', expires_at: expiresAt } };
                    }
                    if (url.includes('/installation/repositories')) {
                        return {
                            body: {
                                total_count: 1,
                                repositories: [{
                                    id: 555,
                                    full_name: 'org/repo',
                                    clone_url: 'https://github.com/org/repo.git',
                                    default_branch: 'main',
                                    private: true,
                                    description: 'Test repo',
                                }],
                            },
                        };
                    }
                    return { ok: false, status: 404, body: {} };
                }),
            });
            service._getCachedToken = async () => null;
            service._cacheToken = async () => {};

            const result = await service.listInstallationRepos(100);
            assert.strictEqual(result.totalCount, 1);
            assert.strictEqual(result.repos[0].fullName, 'org/repo');
            assert.strictEqual(result.repos[0].private, true);
        });
    });

    describe('verifyWebhook', () => {
        it('returns true for valid webhook signature', async () => {
            const service = new GitHubAppService({
                getConfig: async () => mockConfig({ webhookSecret: 'my_secret' }),
            });
            const payload = '{"hello":"world"}';
            const sig = 'sha256=' + crypto.createHmac('sha256', 'my_secret').update(payload).digest('hex');

            const valid = await service.verifyWebhook(payload, sig);
            assert.ok(valid);
        });

        it('returns false for invalid signature', async () => {
            const service = new GitHubAppService({
                getConfig: async () => mockConfig({ webhookSecret: 'my_secret' }),
            });
            const valid = await service.verifyWebhook('{}', 'sha256=bad');
            assert.ok(!valid);
        });

        it('throws when webhook secret is not configured', async () => {
            const service = new GitHubAppService({
                getConfig: async () => ({ appId: '1', webhookSecret: null }),
            });
            await assert.rejects(() => service.verifyWebhook('{}', 'sha256=x'), { statusCode: 503 });
        });
    });

    describe('getApp', () => {
        it('returns normalized app info', async () => {
            const service = new GitHubAppService({
                getConfig: async () => mockConfig(),
                fetch: mockFetch((url) => {
                    if (url.endsWith('/app')) {
                        return {
                            body: {
                                id: 12345,
                                slug: 'xensemble',
                                name: 'XEnsemble',
                                description: 'AI dev platform',
                                html_url: 'https://github.com/apps/xensemble',
                                permissions: { contents: 'read', pull_requests: 'write' },
                                events: ['push', 'pull_request'],
                            },
                        };
                    }
                    return { ok: false, status: 404, body: {} };
                }),
            });

            const app = await service.getApp();
            assert.strictEqual(app.id, 12345);
            assert.strictEqual(app.slug, 'xensemble');
            assert.strictEqual(app.name, 'XEnsemble');
            assert.deepStrictEqual(app.events, ['push', 'pull_request']);
        });
    });
});
