/**
 * Generic Git provider routes — /api/v1/git/*
 *
 * These routes work with any registered provider (github, gitlab, gitea, …).
 * The legacy /api/v1/github/* routes continue to work unchanged; see
 * registerGitHubRoutes() in routes/github.js.
 */
const { eq } = require('drizzle-orm');
const crypto = require('crypto');

const { db } = require('../db/index');
const schema = require('../db/schema');
const { GitConnectionService, getProviderConfig } = require('../git/GitConnectionService');
const { MergeRequestService } = require('../git/MergeRequestService');
const { GitOperationService } = require('../git/GitOperationService');
const { listProviders, getProvider, hasProvider } = require('../git/providers/registry');
const { projectDir } = require('../workspace');
const policy = require('../auth/PolicyService');
const { scaffoldXEnsemble } = require('../repositories/RepositoryEnvironmentService');

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function callbackHtml(success, message) {
    const title = success ? 'Git Connected' : 'Git Connection Failed';
    const body = success
        ? 'Connected successfully. You can close this tab.'
        : escapeHtml(message || 'Failed to connect. Please try again.');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f6f8fa;color:#1f2328}.card{background:#fff;border:1px solid #d1d9e0;border-radius:8px;padding:32px;max-width:480px;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.05)}h1{font-size:20px;margin:0 0 12px}p{margin:0;line-height:1.5;color:#656d76}.error h1{color:#cf222e}</style>
</head><body class="${success ? '' : 'error'}"><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

function newId(prefix) {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

async function getProjectForUser(userId, projectId) {
    const rows = await db.select().from(schema.projects)
        .where(eq(schema.projects.id, projectId));
    if (rows.length === 0 || rows[0].userId !== userId) return null;
    return rows[0];
}

function registerGitRoutes(fastify) {
    const connectionService = new GitConnectionService();
    const mergeRequestService = new MergeRequestService();
    const gitOperationService = new GitOperationService();

    // ── Provider discovery ──

    fastify.get('/api/v1/git/providers', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async () => {
        const names = listProviders();
        return {
            providers: names.map((name) => {
                const p = getProvider(name);
                return {
                    name: p.name,
                    display_name: p.displayName,
                    pr_terminology: p.prTerminology,
                };
            }),
        };
    });

    // ── Connections ──

    fastify.get('/api/v1/git/connections', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request) => {
        const connections = await connectionService.listConnections(request.user.id);
        return { connections };
    });

    fastify.get('/api/v1/git/connections/:provider', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const connection = await connectionService.getConnection(request.user.id, request.params.provider);
        if (!connection) return reply.code(404).send({ error: `${request.params.provider} not connected` });
        return connection;
    });

    // ── OAuth ──

    fastify.post('/api/v1/git/connect', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const provider = request.body?.provider || 'github';
        try {
            const result = await connectionService.initiateOAuth(request.user.id, provider);
            return { auth_url: result.authUrl, provider: result.provider };
        } catch (err) {
            request.log.error(err);
            const code = err.message.includes('not configured') ? 503 : 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/git/callback', async (request, reply) => {
        const { code, state } = request.query || {};
        try {
            await connectionService.completeOAuthFromCallback(code, state);
            return reply.type('text/html').send(callbackHtml(true));
        } catch (err) {
            request.log.error(err);
            return reply.type('text/html').code(400).send(callbackHtml(false, err.message));
        }
    });

    fastify.post('/api/v1/git/callback', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const { code, state } = request.body || {};
        try {
            const connection = await connectionService.completeOAuthFromDesktop(
                request.user.id, code, state);
            return { connection };
        } catch (err) {
            request.log.error(err);
            return reply.code(400).send({ error: err.message });
        }
    });

    fastify.delete('/api/v1/git/connections/:provider', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        try {
            await connectionService.disconnect(request.user.id, request.params.provider);
            return { ok: true };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to disconnect' });
        }
    });

    // ── Repos ──

    fastify.get('/api/v1/git/repos', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const providerName = request.query?.provider || 'github';
        try {
            const token = await connectionService.getDecryptedToken(request.user.id, providerName);
            const provider = getProvider(providerName);
            const config = await getProviderConfig(providerName);
            const { page, per_page, affiliation } = request.query || {};
            const result = await provider.listUserRepos(token, {
                page: page ? Number(page) : 1,
                perPage: per_page ? Number(per_page) : 30,
                affiliation,
                apiBase: config?.apiBase,
            });
            return result;
        } catch (err) {
            request.log.error(err);
            if (err.message.includes('not_connected')) {
                return reply.code(400).send({ error: `${providerName} account not connected` });
            }
            return reply.code(err.status || 500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/git/repos/*', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const providerName = request.query?.provider || 'github';
        // Wildcard captures the full path: owner/repo (GitHub, Gitea) or group/subgroup/repo (GitLab)
        const repoPath = request.params['*'];
        if (!repoPath) return reply.code(400).send({ error: 'repo path is required' });
        try {
            const token = await connectionService.getDecryptedToken(request.user.id, providerName);
            const provider = getProvider(providerName);
            const config = await getProviderConfig(providerName);
            const repoInfo = await provider.getRepo(token, repoPath, { apiBase: config?.apiBase });
            return { repo: repoInfo };
        } catch (err) {
            request.log.error(err);
            if (err.message.includes('not_connected')) {
                return reply.code(400).send({ error: `${providerName} account not connected` });
            }
            return reply.code(err.status || 500).send({ error: err.message });
        }
    });

    // ── Import ──

    fastify.post('/api/v1/projects/import-git', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const quotaCheck = await policy.checkQuota(request.user.id, 'projects', request.user.role);
        if (!quotaCheck.ok) return policy.quotaErrorReply(reply, quotaCheck);

        const {
            provider: providerName = 'github',
            repo_full_name,
            name,
            branch,
            auto_create_branch,
            work_branch_name,
        } = request.body || {};

        if (!repo_full_name) {
            return reply.code(400).send({ error: 'repo_full_name is required' });
        }
        if (!hasProvider(providerName)) {
            return reply.code(400).send({ error: `Unknown provider: ${providerName}` });
        }

        const projectName = String(name || repo_full_name.split('/').pop() || 'project').trim();
        if (!projectName) return reply.code(400).send({ error: 'name is required' });

        let token;
        let connection;
        let repoInfo;
        try {
            connection = await connectionService.getConnection(request.user.id, providerName);
            if (!connection) return reply.code(400).send({ error: `${providerName} account not connected` });
            token = await connectionService.getDecryptedToken(request.user.id, providerName);
            const provider = getProvider(providerName);
            const { getProviderConfig } = require('../git/GitConnectionService');
            const config = await getProviderConfig(providerName);
            repoInfo = await provider.getRepo(token, repo_full_name, { apiBase: config?.apiBase });
        } catch (err) {
            request.log.error(err);
            if (err.message.includes('not_connected')) {
                return reply.code(400).send({ error: `${providerName} account not connected` });
            }
            return reply.code(err.status || 500).send({ error: err.message });
        }

        const projectId = newId('proj');
        const userId = request.user.id;
        const serverPath = projectDir(userId, projectId);
        const createdAt = Date.now();
        const baseBranch = branch || repoInfo.defaultBranch || 'main';
        const autoCreateBranch = auto_create_branch !== false;
        const workBranchName = work_branch_name || `xensemble/${Date.now()}`;
        const currentBranch = autoCreateBranch ? workBranchName : baseBranch;

        const projectRow = {
            id: projectId,
            userId,
            name: projectName,
            serverPath,
            repoProvider: providerName,
            repoUrl: repoInfo.cloneUrl,
            repoDefaultBranch: repoInfo.defaultBranch || 'main',
            repoTokenSecretRef: connection.id,
            workspaceMode: 'git',
            remoteRepoId: repoInfo.id || null,
            remoteFullName: repoInfo.fullName || repo_full_name,
            // Legacy GitHub-specific fields for backward compat
            githubRepoId: providerName === 'github' ? Number(repoInfo.id) || null : null,
            githubFullName: providerName === 'github' ? (repoInfo.fullName || repo_full_name) : null,
            currentBranch,
            cloneStatus: 'cloning',
            createdAt,
        };

        try {
            await db.insert(schema.projects).values(projectRow);
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: 'Failed to create project record' });
        }

        const { ensureProjectRuntime } = require('../runtime/RuntimeService');
        const project = { ...projectRow };

        (async () => {
            try {
                await ensureProjectRuntime(project);
                const cloneResult = await gitOperationService.cloneRepo(project, {
                    repoUrl: repoInfo.cloneUrl,
                    branch: baseBranch,
                });

                let branchSha = cloneResult.sha;
                if (autoCreateBranch) {
                    const createResult = await gitOperationService.createBranch(
                        project, workBranchName, baseBranch);
                    branchSha = createResult.sha;
                }

                await scaffoldXEnsemble(serverPath, {
                    baseBranch,
                    autoCommitOnExit: true,
                });

                await db.update(schema.projects)
                    .set({ cloneStatus: 'ready', cloneError: null })
                    .where(eq(schema.projects.id, projectId));
            } catch (err) {
                request.log.error(err, `Git import failed for project ${projectId}`);
                await db.update(schema.projects)
                    .set({ cloneStatus: 'failed', cloneError: err.message })
                    .where(eq(schema.projects.id, projectId));
            }
        })();

        return reply.code(202).send({
            id: projectId,
            name: projectName,
            provider: providerName,
            remote_full_name: repoInfo.fullName || repo_full_name,
            repo_url: repoInfo.cloneUrl,
            current_branch: currentBranch,
            status: 'cloning',
            created_at: createdAt,
        });
    });

    // ── Merge Requests (generic) ──

    fastify.get('/api/v1/projects/:id/merge-requests', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const rows = await mergeRequestService.list(project.id);
        return { merge_requests: rows };
    });

    fastify.post('/api/v1/projects/:id/merge-requests', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        try {
            const record = await mergeRequestService.create(
                project, request.body || {}, request.user.id);
            return reply.code(201).send(record);
        } catch (err) {
            request.log.error(err);
            return reply.code(400).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/projects/:id/merge-requests/:mrId', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const record = await mergeRequestService.get(request.params.mrId);
        if (!record || record.projectId !== project.id) {
            return reply.code(404).send({ error: 'Merge request not found' });
        }
        return record;
    });

    fastify.post('/api/v1/projects/:id/merge-requests/:mrId/sync', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        try {
            const record = await mergeRequestService.sync(project, request.params.mrId);
            if (!record || record.projectId !== project.id) {
                return reply.code(404).send({ error: 'Merge request not found' });
            }
            return record;
        } catch (err) {
            request.log.error(err);
            return reply.code(400).send({ error: err.message });
        }
    });
}

module.exports = { registerGitRoutes };
