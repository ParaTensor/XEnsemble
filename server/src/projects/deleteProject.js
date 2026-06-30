const fs = require('fs');
const { eq } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const sessionManager = require('../session/SessionManager');
const deploymentService = require('../deployments/DeploymentService');
const workspace = require('../workspace');

async function deleteProjectForUser(userId, project) {
    const projectId = project.id;

    const sessionRows = await db.select().from(schema.sessions)
        .where(eq(schema.sessions.projectId, projectId));
    for (const row of sessionRows) {
        sessionManager.deleteSession(row.id);
    }

    const deploymentRows = await db.select().from(schema.deployments)
        .where(eq(schema.deployments.projectId, projectId));
    for (const dep of deploymentRows) {
        await deploymentService.remove(userId, dep.id);
    }

    // 配套清理：销毁 boxlite/blink sessions 等 runtime 资源（local destroy 为 no-op）
    const runtimeRows = await db.select().from(schema.runtimes)
        .where(eq(schema.runtimes.projectId, projectId));
    const { getRuntime } = require('../runtime/registry');
    const rt = getRuntime();
    for (const rrow of runtimeRows) {
        if (rrow.runtimeRef) {
            try {
                await rt.provider.destroy(rrow.runtimeRef);
            } catch (_) {}
        }
    }

    await db.delete(schema.workspaceCheckpoints).where(eq(schema.workspaceCheckpoints.projectId, projectId));
    await db.delete(schema.repoSnapshots).where(eq(schema.repoSnapshots.projectId, projectId));
    await db.delete(schema.devEnvironmentProfiles).where(eq(schema.devEnvironmentProfiles.projectId, projectId));
    await db.delete(schema.sessions).where(eq(schema.sessions.projectId, projectId));
    await db.delete(schema.deployments).where(eq(schema.deployments.projectId, projectId));
    await db.delete(schema.runtimes).where(eq(schema.runtimes.projectId, projectId));
    await db.delete(schema.events).where(eq(schema.events.projectId, projectId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));

    const dir = workspace.projectDir(userId, projectId);
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

module.exports = { deleteProjectForUser };
