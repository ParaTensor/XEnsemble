/**
 * Abstract interface for external Git platform integration.
 *
 * Each platform (GitHub, GitLab, Gitea, Bitbucket) implements this interface
 * as an adapter. The control plane uses the adapter to perform OAuth,
 * list repositories, create PR/MR, etc. without knowing platform specifics.
 *
 * Git CLI operations (clone, push, commit, branch) are handled separately by
 * GitOperationService which is already platform-agnostic.
 */
class GitProviderService {
    /** @returns {string} Provider identifier: 'github' | 'gitlab' | 'gitea' | 'bitbucket' */
    get name() {
        throw new Error('GitProviderService.name not implemented');
    }

    /** @returns {string} Human-readable name */
    get displayName() {
        throw new Error('GitProviderService.displayName not implemented');
    }

    /** @returns {{ singular: string, plural: string, abbreviation: string }} */
    get prTerminology() {
        return { singular: 'Pull Request', plural: 'Pull Requests', abbreviation: 'PR' };
    }

    // ── OAuth ──

    /**
     * Build the platform's OAuth authorization URL.
     * @param {object} config - { clientId, callbackUrl, state, scope }
     * @returns {string} Full authorization URL
     */
    buildAuthUrl(config) {
        throw new Error('GitProviderService.buildAuthUrl not implemented');
    }

    /**
     * Exchange an OAuth authorization code for access token(s).
     * @param {string} code
     * @param {object} config - { clientId, clientSecret, callbackUrl }
     * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn?: number, scope?: string }>}
     */
    async exchangeCode(code, config) {
        throw new Error('GitProviderService.exchangeCode not implemented');
    }

    /**
     * Refresh an expired access token. Not all providers need this (GitHub tokens don't expire).
     * @param {string} refreshToken
     * @param {object} config - { clientId, clientSecret }
     * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn?: number }>}
     */
    async refreshAccessToken(refreshToken, config) {
        throw new Error(`${this.name} does not support token refresh`);
    }

    /** @returns {boolean} Whether this provider's tokens expire and need refreshing */
    get requiresTokenRefresh() {
        return false;
    }

    // ── User ──

    /**
     * Get the authenticated user's profile.
     * @param {string} token
     * @returns {Promise<{ id: string, username: string, displayName: string, avatarUrl: string, email?: string, tokenScope?: string | null }>}
     *   tokenScope is GitHub-specific: the classic-PAT X-OAuth-Scopes value, or
     *   'fine-grained' when the token is a fine-grained PAT (no scopes header).
     *   GitLab/Gitea adapters do not return it; callers fall back to null.
     */
    async getAuthenticatedUser(token) {
        throw new Error('GitProviderService.getAuthenticatedUser not implemented');
    }

    // ── Repositories ──

    /**
     * List repositories visible to the authenticated user.
     * @param {string} token
     * @param {object} opts - { page?, perPage?, search?, affiliation? }
     * @returns {Promise<{ repos: Array<RepoInfo>, hasMore: boolean }>}
     *   RepoInfo = { id, fullName, cloneUrl, defaultBranch, private, description, language, updatedAt }
     */
    async listUserRepos(token, opts) {
        throw new Error('GitProviderService.listUserRepos not implemented');
    }

    /**
     * Get a single repository by identifier.
     * @param {string} token
     * @param {string} repoIdentifier - 'owner/repo' (GitHub/Gitea) or numeric id / path (GitLab)
     * @returns {Promise<RepoInfo>}
     */
    async getRepo(token, repoIdentifier) {
        throw new Error('GitProviderService.getRepo not implemented');
    }

    // ── Pull Request / Merge Request ──

    /**
     * @param {string} token
     * @param {string} repoIdentifier
     * @param {object} opts - { title, body, head, base }
     * @returns {Promise<PRInfo>}
     *   PRInfo = { number, url, title, body, state, merged, headRef, baseRef, mergeCommitSha }
     */
    async createPR(token, repoIdentifier, opts) {
        throw new Error('GitProviderService.createPR not implemented');
    }

    /** @param {string} token @param {string} repoIdentifier @param {number} prNumber @returns {Promise<PRInfo>} */
    async getPR(token, repoIdentifier, prNumber) {
        throw new Error('GitProviderService.getPR not implemented');
    }

    /** @param {string} token @param {string} repoIdentifier @param {object} opts - { state?, page?, perPage? } @returns {Promise<PRInfo[]>} */
    async listPRs(token, repoIdentifier, opts) {
        throw new Error('GitProviderService.listPRs not implemented');
    }

    // ── Reviews (Phase 4) ──

    /**
     * List reviews/approvals on a PR/MR.
     * @param {string} token
     * @param {string} repoIdentifier
     * @param {number} prNumber
     * @param {object} opts - { apiBase? }
     * @returns {Promise<Array<{ id, user: { login, avatarUrl }, state, body, submittedAt, htmlUrl }>>}
     */
    async listReviews(token, repoIdentifier, prNumber, opts) {
        return [];
    }

    /**
     * List inline review comments on a PR/MR.
     * @param {string} token
     * @param {string} repoIdentifier
     * @param {number} prNumber
     * @param {object} opts - { apiBase?, page?, perPage? }
     * @returns {Promise<Array<{ id, path, line, side, user, body, createdAt, updatedAt, inReplyToId, diffHunk }>>}
     */
    async listReviewComments(token, repoIdentifier, prNumber, opts) {
        return [];
    }

    /**
     * List general PR/MR comments (issue-level, not tied to code lines).
     */
    async listIssueComments(token, repoIdentifier, prNumber, opts) {
        return [];
    }

    /**
     * List changed files with diffs for a PR/MR.
     */
    async listMrFiles(token, repoIdentifier, prNumber, opts) {
        return [];
    }

    // ── PR Actions ──

    async mergePR(token, repoIdentifier, prNumber, opts) {
        throw new Error('GitProviderService.mergePR not implemented');
    }

    async closePR(token, repoIdentifier, prNumber, opts) {
        throw new Error('GitProviderService.closePR not implemented');
    }

    async submitApproval(token, repoIdentifier, prNumber, opts) {
        throw new Error('GitProviderService.submitApproval not implemented');
    }

    async addIssueComment(token, repoIdentifier, prNumber, body, opts) {
        throw new Error('GitProviderService.addIssueComment not implemented');
    }

    // ── Utility ──

    /**
     * Parse a full name into owner + repo (or equivalent for the platform).
     * @param {string} fullName
     * @returns {{ owner: string, repo: string }}
     */
    parseRepoIdentifier(fullName) {
        if (!fullName || typeof fullName !== 'string') {
            throw new Error('fullName is required');
        }
        const parts = fullName.split('/');
        if (parts.length < 2) {
            throw new Error(`Invalid repo identifier: ${fullName}`);
        }
        return { owner: parts.slice(0, -1).join('/'), repo: parts[parts.length - 1] };
    }

    /**
     * Build a clone URL for a repo. Default implementation; adapters may override.
     * @param {string} repoIdentifier
     * @param {object} platformConfig - { apiBase }
     * @returns {string}
     */
    buildCloneUrl(repoIdentifier, platformConfig) {
        throw new Error('GitProviderService.buildCloneUrl not implemented');
    }
}

module.exports = { GitProviderService };
