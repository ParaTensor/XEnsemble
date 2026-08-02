const { eq, and } = require('drizzle-orm');
const { GitOperationService } = require('../github/GitOperationService');
const { LocalGitService } = require('../git/LocalGitService');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { getProjectForUser } = require('../projects/getProjectForUser');
const { withProjectGitLock } = require('../git/gitMutationLock');

async function ensureLocalGitReady(project, log) {
    // Built-in workspace git should always be available for Changes. Backfill
    // projects where create-time initRepo failed (common on BoxLite).
    if (project.repoProvider && project.repoProvider !== 'none' && project.repoProvider !== 'local_git') {
        return project;
    }
    try {
        const localGit = new LocalGitService();
        await localGit.ensureGitInit(project);
        return (await getProjectForUser(project.userId, project.id)) || project;
    } catch (err) {
        log?.warn?.({ err, projectId: project.id }, 'ensureGitInit before git status failed');
        return project;
    }
}

function registerProjectGitRoutes(fastify) {
    const gitOperationService = new GitOperationService();


    fastify.get('/api/v1/projects/:id/git/status', {
        preValidation: [fastify.authenticate, fastify.requireActive],
    }, async (request, reply) => {
        let project = await getProjectForUser(request.user.id, request.params.id);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        try {
            project = await ensureLocalGitReady(project, request.log);
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
            const result = await gitOperationService.getFileDiff(project, filePath);
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
    });}

module.exports = { registerProjectGitRoutes };
