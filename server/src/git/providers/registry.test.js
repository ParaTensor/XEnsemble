const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getProvider, listProviders, hasProvider } = require('./registry');

describe('Provider registry', () => {
    it('lists all registered providers', () => {
        const providers = listProviders();
        assert.ok(providers.includes('github'));
        assert.ok(providers.includes('gitlab'));
        assert.ok(providers.includes('gitea'));
        assert.strictEqual(providers.length, 3);
    });

    it('hasProvider returns true for registered providers', () => {
        assert.strictEqual(hasProvider('github'), true);
        assert.strictEqual(hasProvider('gitlab'), true);
        assert.strictEqual(hasProvider('gitea'), true);
    });

    it('hasProvider returns false for unknown providers', () => {
        assert.strictEqual(hasProvider('bitbucket'), false);
        assert.strictEqual(hasProvider('unknown'), false);
    });

    it('getProvider returns correct adapter for github', () => {
        const provider = getProvider('github');
        assert.strictEqual(provider.name, 'github');
        assert.strictEqual(provider.displayName, 'GitHub');
    });

    it('getProvider returns correct adapter for gitlab', () => {
        const provider = getProvider('gitlab');
        assert.strictEqual(provider.name, 'gitlab');
        assert.strictEqual(provider.displayName, 'GitLab');
    });

    it('getProvider returns correct adapter for gitea', () => {
        const provider = getProvider('gitea');
        assert.strictEqual(provider.name, 'gitea');
        assert.strictEqual(provider.displayName, 'Gitea');
    });

    it('getProvider throws for unknown provider', () => {
        assert.throws(() => getProvider('unknown'), /Unknown git provider: unknown/);
    });

    it('each provider implements the required interface methods', () => {
        for (const name of listProviders()) {
            const p = getProvider(name);
            assert.strictEqual(typeof p.name, 'string');
            assert.strictEqual(typeof p.displayName, 'string');
            assert.strictEqual(typeof p.prTerminology, 'object');
            assert.strictEqual(typeof p.requiresTokenRefresh, 'boolean');
            assert.strictEqual(typeof p.buildAuthUrl, 'function');
            assert.strictEqual(typeof p.exchangeCode, 'function');
            assert.strictEqual(typeof p.getAuthenticatedUser, 'function');
            assert.strictEqual(typeof p.listUserRepos, 'function');
            assert.strictEqual(typeof p.getRepo, 'function');
            assert.strictEqual(typeof p.createPR, 'function');
            assert.strictEqual(typeof p.getPR, 'function');
            assert.strictEqual(typeof p.listPRs, 'function');
            assert.strictEqual(typeof p.parseRepoIdentifier, 'function');
            assert.strictEqual(typeof p.buildCloneUrl, 'function');
        }
    });

    it('GitLab supports token refresh, GitHub does not', () => {
        assert.strictEqual(getProvider('github').requiresTokenRefresh, false);
        assert.strictEqual(getProvider('gitlab').requiresTokenRefresh, true);
        assert.strictEqual(getProvider('gitea').requiresTokenRefresh, true);
    });

    it('GitLab uses MR terminology, GitHub and Gitea use PR', () => {
        assert.strictEqual(getProvider('github').prTerminology.abbreviation, 'PR');
        assert.strictEqual(getProvider('gitlab').prTerminology.abbreviation, 'MR');
        assert.strictEqual(getProvider('gitea').prTerminology.abbreviation, 'PR');
    });
});
