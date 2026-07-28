const crypto = require('crypto');
const { eq, and } = require('drizzle-orm');

const { db } = require('../db/index');
const schema = require('../db/schema');
const { recordEvent } = require('../events/recordEvent');
const { getProvider } = require('./providers/registry');
const { GitConnectionService, getProviderConfig } = require('./GitConnectionService');
const { GitOperationService } = require('./GitOperationService');

class MergeRequestService {
    constructor(deps = {}) {
        this.gitConnectionService = deps.gitConnectionService ?? new GitConnectionService();
        this.gitOperationService = deps.gitOperationService ?? new GitOperationService();
    }

    _generateId() {
        return `mr_${crypto.randomBytes(8).toString('hex')}`;
    }

    _mapStatus({ state, merged }) {
        if (state === 'closed' && merged) return 'merged';
        if (state === 'closed') return 'closed';
        return 'open';
    }

    async create(project, { title, body, sourceBranch, source_branch, targetBranch, target_branch }, actorUserId) {
        const providerName = project.repoProvider;
        if (!providerName || providerName === 'none' || providerName === 'local_git') {
            throw new Error('Project is not connected to an external Git provider');
        }

        const repoFullName = project.remoteFullName || project.githubFullName;
        if (!repoFullName) throw new Error('Project does not have a remote repository identifier');

        const token = await this.gitConnectionService.getDecryptedToken(project.userId, providerName);
        const provider = getProvider(providerName);
        const config = await getProviderConfig(providerName);

        const src = sourceBranch || source_branch || project.currentBranch;
        const tgt = targetBranch || target_branch || project.repoDefaultBranch || 'main';
        if (!src) throw new Error('sourceBranch is required and project.currentBranch is not set');
        if (!title) throw new Error('title is required');

        await this.gitOperationService.pushBranch(project, src);

        const prInfo = await provider.createPR(token, repoFullName, {
            title,
            body,
            head: src,
            base: tgt,
            apiBase: config?.apiBase,
        });

        const now = Date.now();
        const id = this._generateId();
        const record = {
            id,
            projectId: project.id,
            provider: providerName,
            remoteMrNumber: prInfo.number,
            remoteMrUrl: prInfo.url,
            title,
            description: body ?? null,
            sourceBranch: src,
            targetBranch: tgt,
            status: this._mapStatus({ state: prInfo.state, merged: prInfo.merged }),
            remoteState: prInfo.state,
            mergeSha: prInfo.mergeCommitSha ?? null,
            createdBy: actorUserId ?? null,
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: now,
        };

        await db.insert(schema.mergeRequests).values(record);

        await recordEvent({
            userId: actorUserId ?? project.userId,
            projectId: project.id,
            subjectType: 'merge_request',
            subjectId: id,
            type: 'mr.created',
            data: {
                provider: providerName,
                remoteMrNumber: prInfo.number,
                title,
                sourceBranch: src,
                targetBranch: tgt,
            },
        });

        return record;
    }

    async sync(project, mrId) {
        const providerName = project.repoProvider;
        const repoFullName = project.remoteFullName || project.githubFullName;
        if (!repoFullName) throw new Error('Project does not have a remote repository identifier');

        const token = await this.gitConnectionService.getDecryptedToken(project.userId, providerName);
        const provider = getProvider(providerName);
        const config = await getProviderConfig(providerName);

        const existingRows = await db.select().from(schema.mergeRequests)
            .where(eq(schema.mergeRequests.id, mrId));
        if (existingRows.length === 0) throw new Error('merge request not found');
        const existing = existingRows[0];

        const prInfo = await provider.getPR(token, repoFullName, existing.remoteMrNumber, {
            apiBase: config?.apiBase,
        });

        const now = Date.now();
        await db.update(schema.mergeRequests)
            .set({
                title: prInfo.title,
                description: prInfo.body ?? null,
                sourceBranch: prInfo.headRef ?? existing.sourceBranch,
                targetBranch: prInfo.baseRef ?? existing.targetBranch,
                status: this._mapStatus({ state: prInfo.state, merged: prInfo.merged }),
                remoteState: prInfo.state,
                mergeSha: prInfo.mergeCommitSha ?? null,
                updatedAt: now,
                lastSyncedAt: now,
            })
            .where(eq(schema.mergeRequests.id, mrId));

        const rows = await db.select().from(schema.mergeRequests)
            .where(eq(schema.mergeRequests.id, mrId));
        return rows[0];
    }

    async list(projectId) {
        return db.select().from(schema.mergeRequests)
            .where(eq(schema.mergeRequests.projectId, projectId));
    }

    async get(mrId) {
        const rows = await db.select().from(schema.mergeRequests)
            .where(eq(schema.mergeRequests.id, mrId));
        return rows[0] ?? null;
    }

    async _resolveProvider(project, mr) {
        const providerName = project.repoProvider || mr?.provider;
        if (!providerName || providerName === 'none' || providerName === 'local_git') return null;
        const repoFullName = project.remoteFullName || project.githubFullName;
        if (!repoFullName) return null;
        const token = await this.gitConnectionService.getDecryptedToken(project.userId, providerName);
        const provider = getProvider(providerName);
        const config = await getProviderConfig(providerName);
        return { token, provider, repoFullName, apiBase: config?.apiBase };
    }

    async listReviews(project, mrId) {
        const mr = await this.get(mrId);
        if (!mr || mr.projectId !== project.id) return [];
        const ctx = await this._resolveProvider(project, mr);
        if (!ctx) return [];
        return ctx.provider.listReviews(ctx.token, ctx.repoFullName, mr.remoteMrNumber, { apiBase: ctx.apiBase });
    }

    async listReviewComments(project, mrId, opts = {}) {
        const mr = await this.get(mrId);
        if (!mr || mr.projectId !== project.id) return [];
        const ctx = await this._resolveProvider(project, mr);
        if (!ctx) return [];
        return ctx.provider.listReviewComments(ctx.token, ctx.repoFullName, mr.remoteMrNumber, { apiBase: ctx.apiBase, ...opts });
    }
}

module.exports = { MergeRequestService };
