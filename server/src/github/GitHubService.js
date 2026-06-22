const PlatformSettings = require('../admin/PlatformSettings');
const PlatformSecrets = require('../admin/PlatformSecrets');

const DEFAULT_API_BASE = 'https://api.github.com';
const DEFAULT_OAUTH_BASE = 'https://github.com';
const GITHUB_API_VERSION = '2022-11-28';

class GitHubError extends Error {
    constructor(message, code, status) {
        super(message);
        this.name = 'GitHubError';
        this.code = code;
        this.status = status;
    }
}

async function getApiBase() {
    const value = await PlatformSettings.get('GITHUB_API_BASE');
    if (!value) return DEFAULT_API_BASE;
    const trimmed = String(value).trim().replace(/\/+$/, '');
    return trimmed || DEFAULT_API_BASE;
}

async function getOAuthBase() {
    const apiBase = await getApiBase();
    if (apiBase === DEFAULT_API_BASE) return DEFAULT_OAUTH_BASE;
    // GHE: API base is https://ghe.corp.com/api/v3 → OAuth base is https://ghe.corp.com
    try {
        const url = new URL(apiBase);
        return `${url.protocol}//${url.host}`;
    } catch {
        return DEFAULT_OAUTH_BASE;
    }
}

async function getClientCredentials() {
    const clientId = await PlatformSettings.get('GITHUB_CLIENT_ID');
    const encryptedSecret = await PlatformSettings.get('GITHUB_CLIENT_SECRET');
    const clientSecret = encryptedSecret ? PlatformSecrets.getPlatformSecret(encryptedSecret) : null;
    return {
        clientId: clientId ? String(clientId).trim() : null,
        clientSecret: clientSecret ? String(clientSecret).trim() : null,
    };
}

function authHeaders(token) {
    return {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
}

function mapStatusToCode(status) {
    if (status === 401) return 'token_expired';
    if (status === 403) return 'insufficient_scope';
    if (status === 404) return 'repo_not_found';
    return 'github_api_error';
}

async function githubFetch(token, path, opts = {}) {
    const base = await getApiBase();
    const url = `${base}${path}`;
    const options = {
        ...opts,
        headers: {
            ...authHeaders(token),
            ...opts.headers,
        },
    };

    let res;
    try {
        res = await fetch(url, options);
    } catch (cause) {
        throw new GitHubError(`GitHub request failed: ${cause.message}`, 'network_error');
    }

    if (res.ok) {
        return res.json();
    }

    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }

    const message = body?.message || `${path} failed with status ${res.status}`;
    throw new GitHubError(message, mapStatusToCode(res.status), res.status);
}

class GitHubService {
    async exchangeOAuthCode(code) {
        const { clientId, clientSecret } = await getClientCredentials();
        if (!clientId || !clientSecret) {
            throw new GitHubError('GitHub OAuth credentials are not configured', 'not_configured');
        }

        const oauthBase = await getOAuthBase();
        let res;
        try {
            res = await fetch(`${oauthBase}/login/oauth/access_token`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code,
                }),
            });
        } catch (cause) {
            throw new GitHubError(`GitHub OAuth request failed: ${cause.message}`, 'network_error');
        }

        const data = await res.json();
        if (!res.ok || data.error) {
            const message = data.error_description || data.error || `OAuth exchange failed with status ${res.status}`;
            throw new GitHubError(message, data.error || 'oauth_failed');
        }
        if (!data.access_token) {
            throw new GitHubError('OAuth response did not contain an access_token', 'oauth_failed');
        }
        return data.access_token;
    }

    async getAuthenticatedUser(token) {
        return githubFetch(token, '/user');
    }

    async listUserRepos(token, { page = 1, perPage = 30, affiliation = 'owner,collaborator,organization_member' } = {}) {
        const query = new URLSearchParams();
        query.set('page', String(page));
        query.set('per_page', String(perPage));
        if (affiliation) query.set('affiliation', affiliation);
        query.set('sort', 'updated');
        return githubFetch(token, `/user/repos?${query.toString()}`);
    }

    async getRepo(token, owner, repo) {
        return githubFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    }

    async createPullRequest(token, owner, repo, { title, body, head, base }) {
        return githubFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, head, base }),
        });
    }

    async getPullRequest(token, owner, repo, number) {
        return githubFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`);
    }

    async listPullRequests(token, owner, repo, { state = 'open', page = 1, perPage = 30 } = {}) {
        const query = new URLSearchParams();
        query.set('state', state);
        query.set('page', String(page));
        query.set('per_page', String(perPage));
        return githubFetch(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${query.toString()}`);
    }

    async revokeToken(token) {
        return true;
    }
}

module.exports = { GitHubService, GitHubError, getOAuthBase };
