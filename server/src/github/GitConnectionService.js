/**
 * Legacy GitHub connection facade.
 * Delegates to the generic multi-provider GitConnectionService (provider=github)
 * so /api/v1/github/* remains compatible while git_connections is canonical.
 */
const { GitConnectionService: GenericGitConnectionService } = require('../git/GitConnectionService');

class GitConnectionService {
    constructor() {
        this.inner = new GenericGitConnectionService();
    }

    initiateOAuth(userId) {
        return this.inner.initiateOAuth(userId, 'github');
    }

    completeOAuthFromCallback(code, state) {
        return this.inner.completeOAuthFromCallback(code, state);
    }

    completeOAuthFromDesktop(userId, code, state) {
        return this.inner.completeOAuthFromDesktop(userId, code, state);
    }

    getConnection(userId) {
        return this.inner.getConnection(userId, 'github');
    }

    getDecryptedToken(userId) {
        return this.inner.getDecryptedToken(userId, 'github');
    }

    disconnect(userId) {
        return this.inner.disconnect(userId, 'github');
    }
}

module.exports = { GitConnectionService };
