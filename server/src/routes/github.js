const { GitConnectionService } = require('../github/GitConnectionService');
const { GitHubService } = require('../github/GitHubService');

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function callbackHtml(success, message) {
    const title = success ? 'GitHub Connected' : 'GitHub Connection Failed';
    const body = success
        ? 'GitHub connected, you can close this tab.'
        : escapeHtml(message || 'Failed to connect GitHub. Please try again.');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f6f8fa; color: #1f2328; }
    .card { background: #fff; border: 1px solid #d1d9e0; border-radius: 8px; padding: 32px; max-width: 480px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { margin: 0; line-height: 1.5; color: #656d76; }
    .error h1 { color: #cf222e; }
  </style>
</head>
<body class="${success ? '' : 'error'}">
  <div class="card">
    <h1>${title}</h1>
    <p>${body}</p>
  </div>
</body>
</html>`;
}

function registerGitHubRoutes(fastify) {
    const connectionService = new GitConnectionService();
    const gitHubService = new GitHubService();

    fastify.get('/api/v1/github/connection', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const connection = await connectionService.getConnection(request.user.id);
        if (!connection) {
            return reply.code(404).send({ error: 'GitHub not connected' });
        }
        return connection;
    });

    fastify.post('/api/v1/github/connect', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        try {
            const result = await connectionService.initiateOAuth(request.user.id);
            return { auth_url: result.authUrl };
        } catch (err) {
            request.log.error(err);
            const code = err.message === 'GitHub OAuth is not configured' ? 503 : 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/github/callback', async (request, reply) => {
        const { code, state } = request.query || {};
        try {
            await connectionService.completeOAuthFromCallback(code, state);
            return reply.type('text/html').send(callbackHtml(true));
        } catch (err) {
            request.log.error(err);
            return reply.type('text/html').code(400).send(callbackHtml(false, err.message));
        }
    });

    fastify.post('/api/v1/github/callback', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const { code, state } = request.body || {};
        try {
            const connection = await connectionService.completeOAuthFromDesktop(
                request.user.id,
                code,
                state,
            );
            return { connection };
        } catch (err) {
            request.log.error(err);
            return reply.code(400).send({ error: err.message });
        }
    });

    fastify.delete('/api/v1/github/connection', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        try {
            await connectionService.disconnect(request.user.id);
            return { ok: true };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to disconnect GitHub' });
        }
    });

    fastify.get('/api/v1/github/repos', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        try {
            const token = await connectionService.getDecryptedToken(request.user.id);
            const { page, per_page, affiliation } = request.query || {};
            const repos = await gitHubService.listUserRepos(token, {
                page: page ? Number(page) : 1,
                perPage: per_page ? Number(per_page) : 30,
                affiliation,
            });
            return { repos };
        } catch (err) {
            request.log.error(err);
            if (err.message === 'github_not_connected') {
                return reply.code(400).send({ error: 'GitHub account not connected' });
            }
            const code = err.status || 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/github/repos/:owner/:repo', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        try {
            const token = await connectionService.getDecryptedToken(request.user.id);
            const { owner, repo } = request.params;
            const repository = await gitHubService.getRepo(token, owner, repo);
            return { repo: repository };
        } catch (err) {
            request.log.error(err);
            if (err.message === 'github_not_connected') {
                return reply.code(400).send({ error: 'GitHub account not connected' });
            }
            const code = err.status || 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/import-github', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        return reply.code(501).send({ error: 'Not implemented' });
    });
}

module.exports = { registerGitHubRoutes };
