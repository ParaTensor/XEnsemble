/**
 * GitHubAppService — GitHub App authentication and lifecycle management.
 *
 * Handles:
 * - JWT generation from App private key (RS256, 10-minute expiry)
 * - Installation access token exchange (1-hour expiry, auto-refresh)
 * - Webhook payload signature verification (HMAC-SHA256)
 * - Installation lifecycle (list, get, repositories)
 *
 * Admin configures: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET
 * via PlatformSettings / PlatformSecrets.
 */

const crypto = require('crypto');
const auth = require('../auth/index');
const PlatformSettings = require('../admin/PlatformSettings');
const PlatformSecrets = require('../admin/PlatformSecrets');

const DEFAULT_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// ── JWT helpers (RS256, no external dependency) ──

function base64url(buf) {
    return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function buildJWT(appId, privateKeyPem, nowSec) {
    const iat = nowSec - 60; // allow 60s clock drift
    const exp = nowSec + 600; // 10 min max
    const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const payload = base64url(Buffer.from(JSON.stringify({ iss: String(appId), iat, exp })));
    const sigInput = `${header}.${payload}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(sigInput);
    const signature = base64url(sign.sign(privateKeyPem));
    return `${sigInput}.${signature}`;
}

function verifyWebhookSignature(payload, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
    try {
        return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
        return false;
    }
}

// ── Config helpers ──

async function getAppConfig() {
    const appId = await PlatformSettings.get('GITHUB_APP_ID');
    if (!appId) return null;

    const privateKeyEnc = await PlatformSettings.get('GITHUB_APP_PRIVATE_KEY');
    const privateKey = privateKeyEnc ? PlatformSecrets.getPlatformSecret(privateKeyEnc) : null;

    const webhookSecretEnc = await PlatformSettings.get('GITHUB_APP_WEBHOOK_SECRET');
    const webhookSecret = webhookSecretEnc ? PlatformSecrets.getPlatformSecret(webhookSecretEnc) : null;

    const apiBase = await PlatformSettings.get('GITHUB_API_BASE');

    return {
        appId: String(appId).trim(),
        privateKey: privateKey ? String(privateKey).trim() : null,
        webhookSecret: webhookSecret ? String(webhookSecret).trim() : null,
        apiBase: apiBase ? String(apiBase).trim() : DEFAULT_API_BASE,
    };
}

// ── Core service ──

class GitHubAppService {
    constructor(deps = {}) {
        this._getConfig = deps.getConfig ?? getAppConfig;
        this._fetch = deps.fetch ?? globalThis.fetch;
    }

    async _requireConfig() {
        const config = await this._getConfig();
        if (!config || !config.appId || !config.privateKey) {
            throw Object.assign(new Error('GitHub App is not configured'), { statusCode: 503 });
        }
        return config;
    }

    /**
     * Generate a short-lived JWT for GitHub App API calls.
     */
    async generateJWT() {
        const config = await this._requireConfig();
        const now = Math.floor(Date.now() / 1000);
        return buildJWT(config.appId, config.privateKey, now);
    }

    /**
     * Exchange installation ID for an access token (1-hour expiry).
     * Caches in DB to avoid unnecessary API calls.
     */
    async getInstallationToken(installationId) {
        // Check cache first
        const cached = await this._getCachedToken(installationId);
        if (cached) return cached;

        const config = await this._requireConfig();
        const jwt = buildJWT(config.appId, config.privateKey, Math.floor(Date.now() / 1000));
        const apiBase = config.apiBase || DEFAULT_API_BASE;

        let res;
        try {
            res = await this._fetch(`${apiBase}/app/installations/${installationId}/access_tokens`, {
                method: 'POST',
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${jwt}`,
                    'X-GitHub-Api-Version': GITHUB_API_VERSION,
                },
            });
        } catch (cause) {
            throw Object.assign(
                new Error(`Failed to exchange installation token: ${cause.message}`),
                { statusCode: 502 },
            );
        }

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw Object.assign(
                new Error(body.message || `Installation token exchange failed (${res.status})`),
                { statusCode: res.status },
            );
        }

        const data = await res.json();
        const token = data.token;
        const expiresAt = new Date(data.expires_at).getTime();

        // Cache the token
        await this._cacheToken(installationId, token, expiresAt);

        return { token, expiresAt };
    }

    /**
     * List all installations for this GitHub App.
     */
    async listInstallations() {
        const config = await this._requireConfig();
        const jwt = buildJWT(config.appId, config.privateKey, Math.floor(Date.now() / 1000));
        const apiBase = config.apiBase || DEFAULT_API_BASE;

        const res = await this._fetch(`${apiBase}/app/installations`, {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${jwt}`,
                'X-GitHub-Api-Version': GITHUB_API_VERSION,
            },
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw Object.assign(
                new Error(body.message || `Failed to list installations (${res.status})`),
                { statusCode: res.status },
            );
        }

        const installations = await res.json();
        return installations.map((inst) => ({
            id: inst.id,
            account: {
                login: inst.account?.login,
                type: inst.account?.type, // 'User' or 'Organization'
                avatarUrl: inst.account?.avatar_url,
            },
            targetType: inst.target_type,
            permissions: inst.permissions,
            events: inst.events,
            repositorySelection: inst.repository_selection, // 'all' or 'selected'
            createdAt: inst.created_at,
            updatedAt: inst.updated_at,
        }));
    }

    /**
     * List repositories accessible to an installation.
     */
    async listInstallationRepos(installationId, { page = 1, perPage = 30 } = {}) {
        const { token } = await this.getInstallationToken(installationId);
        const config = await this._getConfig();
        const apiBase = config?.apiBase || DEFAULT_API_BASE;

        const query = new URLSearchParams({ page: String(page), per_page: String(perPage) });
        const res = await this._fetch(`${apiBase}/installation/repositories?${query}`, {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': GITHUB_API_VERSION,
            },
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw Object.assign(
                new Error(body.message || `Failed to list repos (${res.status})`),
                { statusCode: res.status },
            );
        }

        const data = await res.json();
        return {
            totalCount: data.total_count,
            repos: (data.repositories || []).map((r) => ({
                id: String(r.id),
                fullName: r.full_name,
                cloneUrl: r.clone_url,
                defaultBranch: r.default_branch || 'main',
                private: r.private || false,
                description: r.description || null,
            })),
        };
    }

    /**
     * Verify a webhook payload signature.
     */
    async verifyWebhook(payload, signatureHeader) {
        const config = await this._getConfig();
        if (!config?.webhookSecret) {
            throw Object.assign(new Error('Webhook secret not configured'), { statusCode: 503 });
        }
        return verifyWebhookSignature(payload, signatureHeader, config.webhookSecret);
    }

    /**
     * Get the authenticated app info.
     */
    async getApp() {
        const config = await this._requireConfig();
        const jwt = buildJWT(config.appId, config.privateKey, Math.floor(Date.now() / 1000));
        const apiBase = config.apiBase || DEFAULT_API_BASE;

        const res = await this._fetch(`${apiBase}/app`, {
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${jwt}`,
                'X-GitHub-Api-Version': GITHUB_API_VERSION,
            },
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw Object.assign(
                new Error(body.message || `Failed to get app info (${res.status})`),
                { statusCode: res.status },
            );
        }

        const app = await res.json();
        return {
            id: app.id,
            slug: app.slug,
            name: app.name,
            description: app.description,
            htmlUrl: app.html_url,
            permissions: app.permissions,
            events: app.events,
        };
    }

    // ── Token cache (in platform_settings, keyed per installation) ──

    async _getCachedToken(installationId) {
        const key = `GITHUB_APP_TOKEN_${installationId}`;
        const raw = await PlatformSettings.get(key);
        if (!raw) return null;

        let entry;
        try { entry = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
        if (!entry?.enc || !entry?.expiresAt) return null;
        if (Date.now() > entry.expiresAt - TOKEN_REFRESH_BUFFER_MS) return null;

        const token = PlatformSecrets.getPlatformSecret(entry.enc);
        if (!token) return null;

        return { token, expiresAt: entry.expiresAt };
    }

    async _cacheToken(installationId, token, expiresAt) {
        const key = `GITHUB_APP_TOKEN_${installationId}`;
        const enc = auth.encryptSecrets({ secret: token });
        await PlatformSettings.set(key, JSON.stringify({ enc, expiresAt }));
    }
}

module.exports = {
    GitHubAppService,
    buildJWT,
    verifyWebhookSignature,
    getAppConfig,
};
