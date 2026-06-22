const PlatformSettings = require('../admin/PlatformSettings');
const PlatformSecrets = require('../admin/PlatformSecrets');

const DEFAULT_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';

class GitHubError extends Error {
    constructor(message, code, status) {
        super(message);
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

function apiError(message, status) {
    const code = status === 401 ? 'token_expired' : status === 403 ? 'insufficient_scope' : status === 404 ? 'repo_not_found' : 'github_api_error';
    return new GitHubError(message, code, status);
}

async function githubFetch(url, options) {
    try {
        return await fetch(url, options);
    } catch (cause) {
        throw new GitHubError(`GitHub request failed: ${cause.message}`, 'network_error');
    }
}

async function checkResponse(res, context) {
    if (res.ok) return;
    let body = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }
    const message = body?.message || `${context} failed with status ${res.status}`;
    throw apiError(message, res.status);
}

async function exchangeOAuthCode(code) {
    const { clientId, clientSecret } = await getClientCredentials();
    if (!clientId || !clientSecret) {
        throw new GitHubError('GitHub OAuth credentials are not configured', 'not_configured');
    }
    const res = await githubFetch('https://github.com/login/oauth/access_token', {
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
    const data = await res.json();
    if (!res.ok || data.error) {
        const message = data.error_description || data.error || `OAuth exchange failed with status ${res.status}`;
        throw new GitHubError(message, data.error || 'oauth_error');
    }
    if (!data.access_token) {
        throw new GitHubError('OAuth response did not contain an access token', 'oauth_error');
    }
    return data.access_token;
}

async function getAuthenticatedUser(token) {
    const base = await getApiBase();
    const res = await githubFetch(`${base}/user`, {
        headers: authHeaders(token),
    });
    await checkResponse(res, 'getAuthenticatedUser');
    const user = await res.json();
    return {
        id: user.id,
        login: user.login,
        avatar_url: user.avatar_url,
    };
}

async function listUserRepos(token, { page = 1, perPage = 30, affiliation = 'owner,collaborator,organization_member' } = {}) {
    const base = await getApiBase();
    const url = new URL(`${base}/user/repos`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    if (affiliation) url.searchParams.set('affiliation', affiliation);
    url.searchParams.set('sort', 'updated');
    const res = await githubFetch(url.toString(), {
        headers: authHeaders(token),
    });
    await checkResponse(res, 'listUserRepos');
    return res.json();
}

async function getRepo(token, owner, repo) {
    const base = await getApiBase();
    const res = await githubFetch(`${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        headers: authHeaders(token),
    });
    await checkResponse(res, 'getRepo');
    return res.json();
}

async function createPullRequest(token, owner, repo, { title, body, head, base }) {
    const baseUrl = await getApiBase();
    const res = await githubFetch(`${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
        method: 'POST',
        headers: {
            ...authHeaders(token),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body, head, base }),
    });
    await checkResponse(res, 'createPullRequest');
    return res.json();
}

async function getPullRequest(token, owner, repo, number) {
    const base = await getApiBase();
    const res = await githubFetch(`${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`, {
        headers: authHeaders(token),
    });
    await checkResponse(res, 'getPullRequest');
    return res.json();
}

async function listPullRequests(token, owner, repo, { state = 'open', page = 1, perPage = 30 } = {}) {
    const base = await getApiBase();
    const url = new URL(`${base}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`);
    url.searchParams.set('state', state);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(perPage));
    const res = await githubFetch(url.toString(), {
        headers: authHeaders(token),
    });
    await checkResponse(res, 'listPullRequests');
    return res.json();
}

async function revokeToken(token) {
    // Phase 1 stub: token revocation is deferred until Phase 2.
    return true;
}

module.exports = {
    GitHubError,
    exchangeOAuthCode,
    getAuthenticatedUser,
    listUserRepos,
    getRepo,
    createPullRequest,
    getPullRequest,
    listPullRequests,
    revokeToken,
};
