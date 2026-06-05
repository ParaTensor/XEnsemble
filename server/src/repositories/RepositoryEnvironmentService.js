const crypto = require('crypto');
const { eq, and } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { recordEvent } = require('../events/recordEvent');

function newId(prefix) {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function safeJson(input, fallback = {}) {
    if (input == null) return fallback;
    if (typeof input === 'string') {
        try { return JSON.parse(input); } catch { return fallback; }
    }
    return input;
}

function formatRepository(project) {
    return {
        project_id: project.id,
        repo_provider: project.repoProvider || 'none',
        repo_url: project.repoUrl || null,
        repo_default_branch: project.repoDefaultBranch || 'main',
        repo_installation_ref: project.repoInstallationRef || null,
        repo_token_secret_ref: project.repoTokenSecretRef || null,
        workspace_mode: project.workspaceMode || 'local',
        last_sync_sha: project.lastSyncSha || null,
        last_snapshot_id: project.lastSnapshotId || null,
        dev_profile_id: project.devProfileId || null,
    };
}

function formatDevProfile(row) {
    if (!row) return null;
    return {
        id: row.id,
        project_id: row.projectId,
        source: row.source,
        profile: safeJson(row.profileJson),
        created_at: row.createdAt,
        updated_at: row.updatedAt,
    };
}

function formatSnapshot(row) {
    if (!row) return null;
    return {
        id: row.id,
        project_id: row.projectId,
        git_sha: row.gitSha,
        branch: row.branch,
        status: row.status,
        storage_ref: row.storageRef,
        build_log: row.buildLog,
        last_error: row.lastError,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        expires_at: row.expiresAt,
    };
}

function formatCheckpoint(row) {
    if (!row) return null;
    return {
        id: row.id,
        project_id: row.projectId,
        session_id: row.sessionId,
        base_snapshot_id: row.baseSnapshotId,
        status: row.status,
        storage_ref: row.storageRef,
        diff_ref: row.diffRef,
        git_sha: row.gitSha,
        created_by: row.createdBy,
        created_at: row.createdAt,
        expires_at: row.expiresAt,
    };
}

async function updateRepository(project, input = {}) {
    const values = {
        repoProvider: input.repo_provider || input.repoProvider || 'generic_git',
        repoUrl: input.repo_url || input.repoUrl || null,
        repoDefaultBranch: input.repo_default_branch || input.repoDefaultBranch || 'main',
        repoInstallationRef: input.repo_installation_ref || input.repoInstallationRef || null,
        repoTokenSecretRef: input.repo_token_secret_ref || input.repoTokenSecretRef || null,
        workspaceMode: input.workspace_mode || input.workspaceMode || 'git',
    };

    await db.update(schema.projects).set(values).where(eq(schema.projects.id, project.id));
    const updated = { ...project, ...values };

    await recordEvent({
        userId: project.userId,
        projectId: project.id,
        subjectType: 'project',
        subjectId: project.id,
        type: 'repository.updated',
        data: {
            repoProvider: values.repoProvider,
            repoUrl: values.repoUrl,
            repoDefaultBranch: values.repoDefaultBranch,
            workspaceMode: values.workspaceMode,
        },
    });

    return formatRepository(updated);
}

async function upsertDevProfile(project, input = {}) {
    const now = Date.now();
    const profile = input.profile || safeJson(input.profile_json, {});
    const profileJson = JSON.stringify(profile || {});
    const source = input.source || 'manual';
    const existingId = input.id || project.devProfileId;

    if (existingId) {
        const rows = await db.select().from(schema.devEnvironmentProfiles)
            .where(and(
                eq(schema.devEnvironmentProfiles.id, existingId),
                eq(schema.devEnvironmentProfiles.projectId, project.id),
            ));
        if (rows.length > 0) {
            await db.update(schema.devEnvironmentProfiles).set({
                source,
                profileJson,
                updatedAt: now,
            }).where(eq(schema.devEnvironmentProfiles.id, existingId));
            return formatDevProfile({ ...rows[0], source, profileJson, updatedAt: now });
        }
    }

    const id = newId('devprof');
    const row = {
        id,
        projectId: project.id,
        source,
        profileJson,
        createdAt: now,
        updatedAt: now,
    };
    await db.insert(schema.devEnvironmentProfiles).values(row);
    await db.update(schema.projects).set({ devProfileId: id }).where(eq(schema.projects.id, project.id));

    await recordEvent({
        userId: project.userId,
        projectId: project.id,
        subjectType: 'project',
        subjectId: project.id,
        type: 'dev_profile.updated',
        data: { devProfileId: id, source },
    });

    return formatDevProfile(row);
}

async function getDevProfile(project) {
    if (!project.devProfileId) return null;
    const rows = await db.select().from(schema.devEnvironmentProfiles)
        .where(and(
            eq(schema.devEnvironmentProfiles.id, project.devProfileId),
            eq(schema.devEnvironmentProfiles.projectId, project.id),
        ));
    return formatDevProfile(rows[0]);
}

async function listSnapshots(projectId) {
    const rows = await db.select().from(schema.repoSnapshots)
        .where(eq(schema.repoSnapshots.projectId, projectId));
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(formatSnapshot);
}

async function createSnapshot(project, input = {}) {
    const now = Date.now();
    const id = newId('snap');
    const status = input.status || 'pending';
    const branch = input.branch || input.repo_default_branch || project.repoDefaultBranch || 'main';
    const row = {
        id,
        projectId: project.id,
        gitSha: input.git_sha || input.gitSha || null,
        branch,
        status,
        storageRef: input.storage_ref || input.storageRef || null,
        buildLog: input.build_log || input.buildLog || null,
        lastError: input.last_error || input.lastError || null,
        createdAt: now,
        updatedAt: now,
        expiresAt: input.expires_at || input.expiresAt || null,
    };

    await db.insert(schema.repoSnapshots).values(row);
    if (status === 'ready') {
        await db.update(schema.projects).set({
            lastSnapshotId: id,
            lastSyncSha: row.gitSha,
        }).where(eq(schema.projects.id, project.id));
    }

    await recordEvent({
        userId: project.userId,
        projectId: project.id,
        subjectType: 'repo_snapshot',
        subjectId: id,
        type: `repo_snapshot.${status}`,
        data: { branch, gitSha: row.gitSha, storageRef: row.storageRef },
    });

    return formatSnapshot(row);
}

async function listCheckpoints(projectId) {
    const rows = await db.select().from(schema.workspaceCheckpoints)
        .where(eq(schema.workspaceCheckpoints.projectId, projectId));
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(formatCheckpoint);
}

async function createCheckpoint(project, input = {}, actorUserId = null) {
    const now = Date.now();
    const id = newId('ckpt');
    const status = input.status || 'ready';
    const row = {
        id,
        projectId: project.id,
        sessionId: input.session_id || input.sessionId || null,
        baseSnapshotId: input.base_snapshot_id || input.baseSnapshotId || project.lastSnapshotId || null,
        status,
        storageRef: input.storage_ref || input.storageRef || null,
        diffRef: input.diff_ref || input.diffRef || null,
        gitSha: input.git_sha || input.gitSha || project.lastSyncSha || null,
        createdBy: actorUserId || input.created_by || input.createdBy || null,
        createdAt: now,
        expiresAt: input.expires_at || input.expiresAt || null,
    };

    await db.insert(schema.workspaceCheckpoints).values(row);
    await recordEvent({
        userId: project.userId,
        projectId: project.id,
        subjectType: 'workspace_checkpoint',
        subjectId: id,
        type: `workspace_checkpoint.${status}`,
        data: {
            sessionId: row.sessionId,
            baseSnapshotId: row.baseSnapshotId,
            storageRef: row.storageRef,
            diffRef: row.diffRef,
        },
    });

    return formatCheckpoint(row);
}

module.exports = {
    formatRepository,
    updateRepository,
    upsertDevProfile,
    getDevProfile,
    listSnapshots,
    createSnapshot,
    listCheckpoints,
    createCheckpoint,
};
