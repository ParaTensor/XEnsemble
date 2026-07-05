const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { eq } = require('drizzle-orm');
const { bootstrapTestDb } = require('../test/db');

let ctx;
let db;
let schema;
let userAdmin;
let PullRequestService;

function createMocks() {
    return {
        gitOperationService: {
            pushBranchCalls: [],
            async pushBranch(project, branchName) {
                this.pushBranchCalls.push({ project, branchName });
                return { sha: 'pushed-sha' };
            },
        },
        gitConnectionService: {
            tokenCalls: [],
            async getDecryptedToken(userId) {
                this.tokenCalls.push(userId);
                return 'gho_test_token';
            },
        },
        gitHubService: {
            createPrCalls: [],
            async createPullRequest(token, owner, repo, { title, body, head, base }) {
                this.createPrCalls.push({ token, owner, repo, title, body, head, base });
                const number = 100 + this.createPrCalls.length - 1;
                return {
                    number,
                    html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
                    state: 'open',
                    merged: false,
                    title,
                    body,
                };
            },
            getPrCalls: [],
            async getPullRequest(token, owner, repo, number) {
                this.getPrCalls.push({ token, owner, repo, number });
                return {
                    number,
                    html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
                    state: 'closed',
                    merged: true,
                    title: 'Updated title',
                    body: 'Updated body',
                    merge_commit_sha: 'merge-abc123',
                    head: { ref: 'feature' },
                    base: { ref: 'main' },
                };
            },
        },
    };
}

describe('PullRequestService', { concurrency: false }, () => {
    let userId;
    let projectId;
    let service;
    let mocks;

    before(async () => {
        ctx = await bootstrapTestDb([
            '../db/index',
            '../admin/UserAdminService',
            '../github/PullRequestService',
        ], __dirname);
        ({ db, schema } = ctx);
        userAdmin = ctx.reloaded['../admin/UserAdminService'];
        ({ PullRequestService } = ctx.reloaded['../github/PullRequestService']);

        const suffix = Date.now();
        const user = await userAdmin.createUser(
            { username: `pr_user_${suffix}`, password: 'Password1!' },
            null,
        );
        userId = user.id;
        projectId = `proj_${suffix}`;

        await db.insert(schema.projects).values({
            id: projectId,
            userId,
            name: 'PR Test Project',
            serverPath: `/tmp/pr-test-${suffix}`,
            githubFullName: 'owner/repo',
            currentBranch: 'feature',
            repoDefaultBranch: 'main',
            createdAt: Date.now(),
        });

        mocks = createMocks();
        service = new PullRequestService({
            gitHubService: mocks.gitHubService,
            gitOperationService: mocks.gitOperationService,
            gitConnectionService: mocks.gitConnectionService,
        });
    });

    after(async () => {
        await db.delete(schema.pullRequests).where(eq(schema.pullRequests.projectId, projectId));
        await db.delete(schema.events).where(eq(schema.events.projectId, projectId));
        await db.delete(schema.events).where(eq(schema.events.userId, userId));
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
        await db.delete(schema.userQuotas).where(eq(schema.userQuotas.userId, userId));
        await db.delete(schema.userAgentGrants).where(eq(schema.userAgentGrants.userId, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        if (ctx) await ctx.teardown();
    });

    it('parseFullName validates owner/repo format', () => {
        assert.deepStrictEqual(service.parseFullName('owner/repo'), { owner: 'owner', repo: 'repo' });
        assert.throws(() => service.parseFullName('owner'), /Invalid githubFullName format/);
        assert.throws(() => service.parseFullName('owner/repo/extra'), /Invalid githubFullName format/);
        assert.throws(() => service.parseFullName(''), /githubFullName is required/);
    });

    it('create pushes branch, creates PR on GitHub and writes to pull_requests', async () => {
        const project = {
            id: projectId,
            userId,
            githubFullName: 'owner/repo',
            currentBranch: 'feature',
            repoDefaultBranch: 'main',
        };

        const result = await service.create(
            project,
            { title: 'Add feature', body: 'Feature description' },
            userId,
        );

        assert.ok(result.id.startsWith('pr_'));
        assert.strictEqual(result.projectId, projectId);
        assert.strictEqual(result.githubPrNumber, 100);
        assert.strictEqual(result.title, 'Add feature');
        assert.strictEqual(result.description, 'Feature description');
        assert.strictEqual(result.sourceBranch, 'feature');
        assert.strictEqual(result.targetBranch, 'main');
        assert.strictEqual(result.status, 'open');
        assert.strictEqual(result.githubState, 'open');
        assert.strictEqual(result.createdBy, userId);

        assert.strictEqual(mocks.gitOperationService.pushBranchCalls.length, 1);
        assert.deepStrictEqual(mocks.gitOperationService.pushBranchCalls[0].project, project);
        assert.strictEqual(mocks.gitOperationService.pushBranchCalls[0].branchName, 'feature');

        assert.deepStrictEqual(mocks.gitConnectionService.tokenCalls, [userId]);

        assert.strictEqual(mocks.gitHubService.createPrCalls.length, 1);
        const createCall = mocks.gitHubService.createPrCalls[0];
        assert.strictEqual(createCall.token, 'gho_test_token');
        assert.strictEqual(createCall.owner, 'owner');
        assert.strictEqual(createCall.repo, 'repo');
        assert.strictEqual(createCall.title, 'Add feature');
        assert.strictEqual(createCall.body, 'Feature description');
        assert.strictEqual(createCall.head, 'feature');
        assert.strictEqual(createCall.base, 'main');

        const stored = await db
            .select()
            .from(schema.pullRequests)
            .where(eq(schema.pullRequests.id, result.id));
        assert.strictEqual(stored.length, 1);
        assert.strictEqual(stored[0].title, 'Add feature');
        assert.strictEqual(stored[0].status, 'open');

        const events = await db
            .select()
            .from(schema.events)
            .where(eq(schema.events.subjectId, result.id));
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, 'pr.created');
        assert.strictEqual(events[0].projectId, projectId);
        assert.strictEqual(events[0].userId, userId);
    });

    it('create respects snake_case target_branch', async () => {
        const project = {
            id: projectId,
            userId,
            githubFullName: 'owner/repo',
            currentBranch: 'feature',
            repoDefaultBranch: 'main',
        };

        const result = await service.create(
            project,
            { title: 'Snake case PR', body: 'Body', source_branch: 'snake-feature', target_branch: 'snake-base' },
            userId,
        );

        assert.strictEqual(result.sourceBranch, 'snake-feature');
        assert.strictEqual(result.targetBranch, 'snake-base');

        assert.strictEqual(mocks.gitOperationService.pushBranchCalls.at(-1).branchName, 'snake-feature');

        const createCall = mocks.gitHubService.createPrCalls.at(-1);
        assert.strictEqual(createCall.head, 'snake-feature');
        assert.strictEqual(createCall.base, 'snake-base');
    });

    it('sync updates PR status from GitHub', async () => {
        const prId = `pr_${Date.now()}`;
        const now = Date.now();
        await db.insert(schema.pullRequests).values({
            id: prId,
            projectId,
            githubPrNumber: 7,
            githubPrUrl: 'https://github.com/owner/repo/pull/7',
            title: 'Old title',
            description: 'Old body',
            sourceBranch: 'feature',
            targetBranch: 'main',
            status: 'open',
            githubState: 'open',
            mergeSha: null,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: now,
        });

        const project = {
            id: projectId,
            userId,
            githubFullName: 'owner/repo',
            currentBranch: 'feature',
            repoDefaultBranch: 'main',
        };

        const result = await service.sync(project, prId);

        assert.strictEqual(result.id, prId);
        assert.strictEqual(result.githubPrNumber, 7);
        assert.strictEqual(result.status, 'merged');
        assert.strictEqual(result.githubState, 'closed');
        assert.strictEqual(result.title, 'Updated title');
        assert.strictEqual(result.description, 'Updated body');
        assert.strictEqual(result.mergeSha, 'merge-abc123');
        assert.ok(result.lastSyncedAt >= now);

        assert.strictEqual(mocks.gitConnectionService.tokenCalls.at(-1), userId);
        assert.strictEqual(mocks.gitHubService.getPrCalls.length, 1);
        const getCall = mocks.gitHubService.getPrCalls[0];
        assert.strictEqual(getCall.token, 'gho_test_token');
        assert.strictEqual(getCall.owner, 'owner');
        assert.strictEqual(getCall.repo, 'repo');
        assert.strictEqual(getCall.number, 7);
    });

    it('list and get return PR records', async () => {
        const prId = `pr_list_${Date.now()}`;
        const now = Date.now();
        await db.insert(schema.pullRequests).values({
            id: prId,
            projectId,
            githubPrNumber: 8,
            githubPrUrl: 'https://github.com/owner/repo/pull/8',
            title: 'Listed PR',
            description: null,
            sourceBranch: 'dev',
            targetBranch: 'main',
            status: 'open',
            githubState: 'open',
            mergeSha: null,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: now,
        });

        const list = await service.list(projectId);
        assert.ok(list.length >= 1);
        assert.ok(list.some((pr) => pr.id === prId));

        const got = await service.get(prId);
        assert.ok(got);
        assert.strictEqual(got.id, prId);
        assert.strictEqual(got.title, 'Listed PR');

        const missing = await service.get('pr_does_not_exist');
        assert.strictEqual(missing, null);
    });
});
