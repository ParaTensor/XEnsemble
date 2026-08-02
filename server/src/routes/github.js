const { eq, and } = require('drizzle-orm');
const crypto = require('crypto');

const { GitConnectionService } = require('../github/GitConnectionService');
const { GitHubService } = require('../github/GitHubService');
const { GitOperationService } = require('../github/GitOperationService');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { projectDir } = require('../workspace');
const policy = require('../auth/PolicyService');
const { scaffoldXEnsemble } = require('../repositories/RepositoryEnvironmentService');
const { withProjectGitLock } = require('../git/gitMutationLock');

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
        ? 'GitHub connected. This window will close automatically.'
        : escapeHtml(message || 'Failed to connect GitHub. Please try again.');
    const payload = JSON.stringify({
        type: 'git-oauth-result',
        provider: 'github',
        status: success ? 'success' : 'error',
        message: success ? null : String(message || 'Failed to connect GitHub'),
    }).replace(/</g, '\\u003c');
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
<script>
(function(){
  try{
    if(window.opener&&!window.opener.closed){
      var origins=${JSON.stringify(
        (process.env.ALLOWED_ORIGINS || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )};
      if(!origins.length){window.opener.postMessage(${payload},'*');}
      else{for(var i=0;i<origins.length;i++){try{window.opener.postMessage(${payload},origins[i]);}catch(e){}}}
    }
  }catch(e){}
  if(${success ? 'true' : 'false'}){setTimeout(function(){window.close();},1200);}
})();
</script>
</body>
</html>`;
}

const { getProjectForUser } = require('../projects/getProjectForUser');

function parseRepoFullName(fullName) {
    if (!fullName || typeof fullName !== 'string') {
        throw new Error('github_repo_full_name is required');
    }
    const [owner, repo, ...rest] = fullName.split('/');
    if (!owner || !repo || rest.length > 0) {
        throw new Error(`Invalid github_repo_full_name format: ${fullName}`);
    }
    return { owner, repo };
}

function newId(prefix) {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

async function upsertProjectBranch(projectId, branchName, values = {}) {
    const now = Date.now();
    const existing = await db.select().from(schema.projectBranches)
        .where(and(
            eq(schema.projectBranches.projectId, projectId),
            eq(schema.projectBranches.branchName, branchName),
        ));

    if (existing.length > 0) {
        await db.update(schema.projectBranches)
            .set({
                ...values,
                updatedAt: now,
            })
            .where(eq(schema.projectBranches.id, existing[0].id));
        return existing[0].id;
    }

    const id = newId('br');
    await db.insert(schema.projectBranches).values({
        id,
        projectId,
        branchName,
        baseBranch: values.baseBranch || null,
        isActive: values.isActive ?? false,
        lastCommitSha: values.lastCommitSha || null,
        aheadCount: values.aheadCount ?? 0,
        behindCount: values.behindCount ?? 0,
        createdAt: now,
        updatedAt: now,
    });
    return id;
}

function registerGitHubRoutes(fastify) {
    const connectionService = new GitConnectionService();
    const gitHubService = new GitHubService();
    const gitOperationService = new GitOperationService();

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
        const quotaCheck = await policy.checkQuota(request.user.id, 'projects', request.user.role);
        if (!quotaCheck.ok) return policy.quotaErrorReply(reply, quotaCheck);

        const {
            github_repo_full_name,
            name,
            branch,
            auto_create_branch,
            work_branch_name,
        } = request.body || {};

        let owner;
        let repo;
        try {
            ({ owner, repo } = parseRepoFullName(github_repo_full_name));
        } catch (err) {
            return reply.code(400).send({ error: err.message });
        }

        const projectName = String(name || repo).trim();
        if (!projectName) {
            return reply.code(400).send({ error: 'name is required' });
        }

        let token;
        let connection;
        let ghRepo;
        try {
            connection = await connectionService.getConnection(request.user.id);
            if (!connection) {
                return reply.code(400).send({ error: 'GitHub account not connected' });
            }
            token = await connectionService.getDecryptedToken(request.user.id);
            ghRepo = await gitHubService.getRepo(token, owner, repo);
        } catch (err) {
            request.log.error(err);
            if (err.message === 'github_not_connected') {
                return reply.code(400).send({ error: 'GitHub account not connected' });
            }
            const code = err.status || 500;
            return reply.code(code).send({ error: err.message });
        }

        const projectId = newId('proj');
        const userId = request.user.id;
        const serverPath = projectDir(userId, projectId);
        const createdAt = Date.now();
        const baseBranch = branch || ghRepo.default_branch || 'main';
        const autoCreateBranch = auto_create_branch !== false;
        const workBranchName = work_branch_name || `xensemble/${Date.now()}`;
        const currentBranch = autoCreateBranch ? workBranchName : baseBranch;

        const projectRow = {
            id: projectId,
            userId,
            name: projectName,
            serverPath,
            repoProvider: 'github',
            repoUrl: ghRepo.clone_url,
            repoDefaultBranch: ghRepo.default_branch || 'main',
            repoTokenSecretRef: connection.id,
            workspaceMode: 'git',
            githubRepoId: ghRepo.id || null,
            githubFullName: ghRepo.full_name || github_repo_full_name,
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
                const ready = await ensureProjectRuntime(project);
                const workspacePath = ready?.workspacePath;
                // Update the in-memory project object so that subsequent
                // _execGit -> ensureProjectRuntime calls use the fast path
                // (cached runtime row) instead of re-entering ensureReady,
                // which can trigger a VM delete+recreate race.
                if (ready?.runtime?.id) {
                    project.defaultRuntimeId = ready.runtime.id;
                }
                const cloneResult = await gitOperationService.cloneRepo(project, {
                    repoUrl: ghRepo.clone_url,
                    branch: baseBranch,
                });

                let branchSha = cloneResult.sha;
                if (autoCreateBranch) {
                    const createResult = await gitOperationService.createBranch(
                        project,
                        workBranchName,
                        baseBranch,
                    );
                    branchSha = createResult.sha;
                }

                await scaffoldXEnsemble(workspacePath, {
                    baseBranch,
                    autoCommitOnExit: true,
                });

                await db.update(schema.projects)
                    .set({ cloneStatus: 'ready', cloneError: null })
                    .where(eq(schema.projects.id, projectId));

                await upsertProjectBranch(projectId, currentBranch, {
                    baseBranch,
                    isActive: true,
                    lastCommitSha: branchSha,
                });
            } catch (err) {
                request.log.error(err, `GitHub import failed for project ${projectId}`);
                await db.update(schema.projects)
                    .set({ cloneStatus: 'failed', cloneError: err.message })
                    .where(eq(schema.projects.id, projectId));
            }
        })();

        return reply.code(202).send({
            id: projectId,
            name: projectName,
            github_full_name: ghRepo.full_name || github_repo_full_name,
            repo_url: ghRepo.clone_url || `https://github.com/${owner}/${repo}.git`,
            current_branch: currentBranch,
            status: 'cloning',
            created_at: createdAt,
        });
    });

    // ─── Git routes ───

    fastify.get('/api/v1/projects/:id/git/status', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        try {
            const mode = request.query.mode === 'light' ? 'light' : 'full';
            const status = mode === 'light'
                ? await gitOperationService.getStatusLight(project)
                : await gitOperationService.getStatus(project);
            return status;
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/:id/git/commit', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const message = String(request.body?.message || '').trim();
        if (!message) return reply.code(400).send({ error: 'message is required' });
        const authorName = request.body?.author?.name || request.user.displayName || request.user.username || '';
        const authorEmail = request.body?.author?.email || request.user.email || '';
        if (!authorName || !authorEmail) {
            return reply.code(400).send({
                error: 'Git author info required',
                code: 'AUTHOR_REQUIRED',
                hint: '请提供 git 提交所需的用户名和邮箱',
            });
        }
        try {
            const author = { name: authorName, email: authorEmail };
            const result = await gitOperationService.commitStaged(project, message, author);
            const status = await gitOperationService.getStatus(project).catch(() => null);
            return { ...result, status };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/:id/git/stage', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const files = request.body?.files;
        if (!Array.isArray(files) || files.length === 0) {
            return reply.code(400).send({ error: 'files array is required' });
        }
        try {
            await gitOperationService.stageFiles(project, files);
            return { ok: true };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/:id/git/unstage', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const files = request.body?.files;
        if (!Array.isArray(files) || files.length === 0) {
            return reply.code(400).send({ error: 'files array is required' });
        }
        try {
            await gitOperationService.unstageFiles(project, files);
            return { ok: true };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/:id/git/push', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const branchName = request.body?.branch || project.currentBranch;
        if (!branchName) return reply.code(400).send({ error: 'No current branch to push' });
        try {
            const result = await gitOperationService.pushBranch(project, branchName);
            const status = await gitOperationService.getStatus(project).catch(() => null);
            return { ...result, status };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/projects/:id/git/diff', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        try {
            const result = await gitOperationService.getDiff(project, {
                base: request.query?.base,
                head: request.query?.head,
            });
            return {
                diff: result.diff,
                truncated: Boolean(result.truncated),
                binary: Boolean(result.binary),
                omitted_bytes: result.omittedBytes || 0,
            };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/projects/:id/git/file-diff', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const filePath = request.query?.path;
        if (!filePath) return reply.code(400).send({ error: 'path is required' });
        try {
            const diff = await gitOperationService.getFileDiff(project, filePath);
            return { diff };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/projects/:id/git/file-content', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const filePath = request.query?.path;
        const ref = request.query?.ref || 'HEAD';
        if (!filePath) return reply.code(400).send({ error: 'path is required' });
        try {
            const content = await gitOperationService.getFileContentAtRef(project, filePath, ref);
            return { content, ref };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/projects/:id/git/file-diff-view', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const filePath = request.query?.path;
        if (!filePath) return reply.code(400).send({ error: 'path is required' });
        try {
            const view = await gitOperationService.getFileDiffView(project, filePath);
            return {
                original: view.original,
                modified: view.modified,
                truncated: Boolean(view.truncated),
                binary: Boolean(view.binary),
            };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/:id/git/pull', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        try {
            await withProjectGitLock(project.id, async () => {
                const { stdout: branch } = await gitOperationService._execGit(project, ['rev-parse', '--abbrev-ref', 'HEAD']);
                const current = branch.trim();
                let target = current;
                let remoteRef = `origin/${current}`;
                let existsOnRemote = true;
                try {
                    await gitOperationService._execGit(project, ['rev-parse', '--verify', '--quiet', remoteRef]);
                } catch {
                    existsOnRemote = false;
                }
                if (!existsOnRemote) {
                    try {
                        const { stdout: defaultRef } = await gitOperationService._execGit(project, [
                            'symbolic-ref', '--short', 'refs/remotes/origin/HEAD',
                        ]);
                        target = defaultRef.trim().split('/').pop();
                    } catch {
                        target = 'main';
                    }
                }
                await gitOperationService._execGit(project, ['pull', 'origin', target]);
            });
            return { ok: true };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/v1/projects/:id/git/clone-status', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        return {
            clone_status: project.cloneStatus || 'pending',
            clone_error: project.cloneError || null,
        };
    });

    fastify.post('/api/v1/projects/:id/git/clone', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        return reply.code(501).send({ error: 'Re-clone route is not implemented yet' });
    });

    fastify.get('/api/v1/projects/:id/git/log', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        try {
            const log = await gitOperationService.getLog(project, {
                branch: request.query?.branch,
                limit: request.query?.limit ? Number(request.query.limit) : 20,
            });
            return { log };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Branch routes ───

    fastify.get('/api/v1/projects/:id/branches', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        try {
            const branches = await gitOperationService.listBranches(project);
            return { branches };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/:id/branches', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const name = String(request.body?.name || '').trim();
        if (!name) return reply.code(400).send({ error: 'name is required' });
        const baseBranch = request.body?.base_branch || project.repoDefaultBranch || 'main';
        try {
            const result = await gitOperationService.createBranch(project, name, baseBranch);
            await upsertProjectBranch(project.id, name, {
                baseBranch,
                isActive: false,
                lastCommitSha: result.sha,
            });
            return result;
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/:id/branches/switch', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const name = String(request.body?.name || '').trim();
        if (!name) return reply.code(400).send({ error: 'name is required' });
        try {
            const result = await gitOperationService.switchBranch(project, name);
            await db.update(schema.projects)
                .set({ currentBranch: name })
                .where(eq(schema.projects.id, project.id));

            await db.update(schema.projectBranches)
                .set({ isActive: false })
                .where(eq(schema.projectBranches.projectId, project.id));
            await upsertProjectBranch(project.id, name, {
                isActive: true,
                lastCommitSha: result.sha,
            });
            return result;
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.delete('/api/v1/projects/:id/branches/:name', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const name = request.params.name;
        if (project.currentBranch === name) {
            return reply.code(400).send({ error: 'Cannot delete the currently checked out branch' });
        }
        try {
            await gitOperationService.deleteBranch(project, name);
            await db.delete(schema.projectBranches)
                .where(and(
                    eq(schema.projectBranches.projectId, project.id),
                    eq(schema.projectBranches.branchName, name),
                ));
            return { ok: true };
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/v1/projects/:id/branches/merge', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        const project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const fromBranch = String(request.body?.from_branch || '').trim();
        const toBranch = String(request.body?.to_branch || project.currentBranch || '').trim();
        if (!fromBranch) return reply.code(400).send({ error: 'from_branch is required' });
        if (!toBranch) return reply.code(400).send({ error: 'to_branch is required' });
        try {
            const result = await gitOperationService.mergeBranch(project, fromBranch, toBranch);
            return result;
        } catch (err) {
            request.log.error(err);
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = { registerGitHubRoutes };
