const crypto = require('crypto');
const { eq } = require('drizzle-orm');

const { db } = require('../db/index');
const schema = require('../db/schema');
const { recordEvent } = require('../events/recordEvent');
const { GitHubService } = require('./GitHubService');
const { GitOperationService } = require('./GitOperationService');
const { GitConnectionService } = require('./GitConnectionService');

class PullRequestService {
    constructor(deps = {}) {
        this.gitHubService = deps.gitHubService ?? new GitHubService();
        this.gitOperationService = deps.gitOperationService ?? new GitOperationService();
        this.gitConnectionService = deps.gitConnectionService ?? new GitConnectionService(this.gitHubService);
    }

    parseFullName(fullName) {
        if (!fullName || typeof fullName !== 'string') {
            throw new Error('githubFullName is required');
        }
        const [owner, repo, ...rest] = fullName.split('/');
        if (!owner || !repo || rest.length > 0) {
            throw new Error(`Invalid githubFullName format: ${fullName}`);
        }
        return { owner, repo };
    }

    _generateId() {
        return `pr_${crypto.randomBytes(8).toString('hex')}`;
    }

    _mapStatus({ state, merged }) {
        if (state === 'closed' && merged) {
            return 'merged';
        }
        if (state === 'closed') {
            return 'closed';
        }
        return 'open';
    }

    async create(project, { title, body, sourceBranch, targetBranch }, actorUserId) {
        const { owner, repo } = this.parseFullName(project.githubFullName);
        const token = await this.gitConnectionService.getDecryptedToken(project.userId);

        const src = sourceBranch ?? project.currentBranch;
        const tgt = targetBranch ?? project.repoDefaultBranch ?? 'main';
        if (!src) {
            throw new Error('sourceBranch is required and project.currentBranch is not set');
        }
        if (!title) {
            throw new Error('title is required');
        }

        await this.gitOperationService.pushBranch(project, src);

        const ghPr = await this.gitHubService.createPullRequest(token, owner, repo, {
            title,
            body,
            head: src,
            base: tgt,
        });

        const now = Date.now();
        const id = this._generateId();
        const record = {
            id,
            projectId: project.id,
            githubPrNumber: ghPr.number,
            githubPrUrl: ghPr.html_url,
            title,
            description: body ?? null,
            sourceBranch: src,
            targetBranch: tgt,
            status: this._mapStatus({ state: ghPr.state, merged: ghPr.merged }),
            githubState: ghPr.state,
            mergeSha: ghPr.merge_commit_sha ?? null,
            createdBy: actorUserId ?? null,
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: now,
        };

        await db.insert(schema.pullRequests).values(record);

        await recordEvent({
            userId: actorUserId ?? project.userId,
            projectId: project.id,
            subjectType: 'pull_request',
            subjectId: id,
            type: 'pr.created',
            data: {
                githubPrNumber: ghPr.number,
                title,
                sourceBranch: src,
                targetBranch: tgt,
            },
        });

        return record;
    }

    async sync(project, prId) {
        const { owner, repo } = this.parseFullName(project.githubFullName);
        const token = await this.gitConnectionService.getDecryptedToken(project.userId);

        const existingRows = await db
            .select()
            .from(schema.pullRequests)
            .where(eq(schema.pullRequests.id, prId));
        if (existingRows.length === 0) {
            throw new Error('pull request not found');
        }
        const existing = existingRows[0];

        const ghPr = await this.gitHubService.getPullRequest(token, owner, repo, existing.githubPrNumber);
        const now = Date.now();

        await db
            .update(schema.pullRequests)
            .set({
                title: ghPr.title,
                description: ghPr.body ?? null,
                sourceBranch: ghPr.head?.ref ?? existing.sourceBranch,
                targetBranch: ghPr.base?.ref ?? existing.targetBranch,
                status: this._mapStatus({ state: ghPr.state, merged: ghPr.merged }),
                githubState: ghPr.state,
                mergeSha: ghPr.merge_commit_sha ?? null,
                updatedAt: now,
                lastSyncedAt: now,
            })
            .where(eq(schema.pullRequests.id, prId));

        const rows = await db
            .select()
            .from(schema.pullRequests)
            .where(eq(schema.pullRequests.id, prId));
        return rows[0];
    }

    async list(projectId) {
        return db
            .select()
            .from(schema.pullRequests)
            .where(eq(schema.pullRequests.projectId, projectId));
    }

    async get(prId) {
        const rows = await db
            .select()
            .from(schema.pullRequests)
            .where(eq(schema.pullRequests.id, prId));
        return rows[0] ?? null;
    }
}

module.exports = { PullRequestService };
