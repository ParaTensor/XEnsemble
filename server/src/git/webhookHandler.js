/**
 * GitHub App Webhook Event Handler.
 *
 * Processes incoming webhook events and updates local state:
 * - pull_request: sync PR/MR status in merge_requests table
 * - push: update project last_sync_sha
 * - installation / installation_repositories: track installations
 */

const { eq, and } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { recordEvent } = require('../events/recordEvent');

function normalizeAction(event, action) {
    return `${event}.${action}`;
}

// ── PR events ──

async function handlePullRequest(payload) {
    const pr = payload.pull_request;
    if (!pr) return { handled: false };

    const repo = payload.repository;
    const repoFullName = repo?.full_name;
    if (!repoFullName) return { handled: false };

    // Find projects linked to this repo (check both githubFullName and remoteFullName,
    // then deduplicate — a project may have both fields set to the same value).
    const projects = await db.select().from(schema.projects)
        .where(eq(schema.projects.githubFullName, repoFullName));

    const altProjects = await db.select().from(schema.projects)
        .where(eq(schema.projects.remoteFullName, repoFullName));
    for (const p of altProjects) {
        if (!projects.find((x) => x.id === p.id)) projects.push(p);
    }

    if (projects.length === 0) return { handled: false, reason: 'no_matching_project' };

    const action = payload.action; // opened, closed, synchronize, reopened, etc.
    const state = pr.merged ? 'merged' : pr.state; // open, closed, merged

    for (const project of projects) {
        // Update merge_requests table if the PR exists
        const existing = await db.select().from(schema.mergeRequests)
            .where(and(
                eq(schema.mergeRequests.projectId, project.id),
                eq(schema.mergeRequests.remoteMrNumber, pr.number),
            ));

        if (existing.length > 0) {
            await db.update(schema.mergeRequests).set({
                status: state,
                remoteState: state,
                mergeSha: pr.merge_commit_sha || null,
                updatedAt: Date.now(),
                lastSyncedAt: Date.now(),
            }).where(eq(schema.mergeRequests.id, existing[0].id));
        }

        await recordEvent({
            userId: project.userId,
            projectId: project.id,
            subjectType: 'webhook',
            subjectId: `pr-${pr.number}`,
            type: normalizeAction('pull_request', action),
            data: {
                prNumber: pr.number,
                state,
                title: pr.title,
                headRef: pr.head?.ref,
                baseRef: pr.base?.ref,
                merged: pr.merged || false,
            },
        });
    }

    return { handled: true, action, prNumber: pr.number, projectCount: projects.length };
}

// ── Push events ──

async function handlePush(payload) {
    const repo = payload.repository;
    const repoFullName = repo?.full_name;
    if (!repoFullName) return { handled: false };

    const ref = payload.ref; // refs/heads/main
    const branch = ref?.replace('refs/heads/', '') || null;
    const headCommit = payload.head_commit?.id || payload.after;

    const projects = await db.select().from(schema.projects)
        .where(eq(schema.projects.githubFullName, repoFullName));

    // Also check remoteFullName
    const altProjects = await db.select().from(schema.projects)
        .where(eq(schema.projects.remoteFullName, repoFullName));
    for (const p of altProjects) {
        if (!projects.find((x) => x.id === p.id)) projects.push(p);
    }

    if (projects.length === 0) return { handled: false, reason: 'no_matching_project' };

    for (const project of projects) {
        // Update last_sync_sha if push is to the project's default branch
        if (branch === (project.repoDefaultBranch || 'main')) {
            await db.update(schema.projects).set({
                lastSyncSha: headCommit,
            }).where(eq(schema.projects.id, project.id));
        }

        await recordEvent({
            userId: project.userId,
            projectId: project.id,
            subjectType: 'webhook',
            subjectId: `push-${headCommit?.slice(0, 8)}`,
            type: 'push',
            data: {
                ref,
                branch,
                headCommit,
                commitsCount: payload.commits?.length || 0,
            },
        });
    }

    return { handled: true, branch, headCommit, projectCount: projects.length };
}

// ── Installation events ──

async function handleInstallation(payload) {
    const action = payload.action; // created, deleted, suspend, unsuspend
    const installation = payload.installation;
    if (!installation) return { handled: false };

    await recordEvent({
        userId: '__system__',
        projectId: null,
        subjectType: 'github_app_installation',
        subjectId: String(installation.id),
        type: normalizeAction('installation', action),
        data: {
            installationId: installation.id,
            account: installation.account?.login,
            accountType: installation.account?.type,
            repositorySelection: installation.repository_selection,
        },
    });

    return { handled: true, action, installationId: installation.id };
}

// ── Installation repositories changed ──

async function handleInstallationRepositories(payload) {
    const action = payload.action; // added, removed
    const installation = payload.installation;
    const added = payload.repositories_added || [];
    const removed = payload.repositories_removed || [];

    await recordEvent({
        userId: '__system__',
        projectId: null,
        subjectType: 'github_app_installation',
        subjectId: String(installation?.id),
        type: normalizeAction('installation_repositories', action),
        data: {
            installationId: installation?.id,
            added: added.map((r) => r.full_name),
            removed: removed.map((r) => r.full_name),
        },
    });

    return { handled: true, action, added: added.length, removed: removed.length };
}

// ── Dispatch ──

const EVENT_HANDLERS = {
    pull_request: handlePullRequest,
    push: handlePush,
    installation: handleInstallation,
    installation_repositories: handleInstallationRepositories,
};

async function handleWebhookEvent(event, payload) {
    const handler = EVENT_HANDLERS[event];
    if (!handler) return { handled: false, reason: `unhandled_event: ${event}` };
    return handler(payload);
}

module.exports = {
    handleWebhookEvent,
    handlePullRequest,
    handlePush,
    handleInstallation,
    handleInstallationRepositories,
};
