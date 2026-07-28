const fs = require('fs');
const { eq } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const sessionManager = require('../session/SessionManager');
const { WorkspaceShellManager } = require('../session/workspaceShell');
const deploymentService = require('../deployments/DeploymentService');
const workspace = require('../workspace');

async function deleteProjectForUser(userId, project, opts = {}) {
    const projectId = project.id;
    const log = opts.log || null;

    const sessionRows = await db.select().from(schema.sessions)
        .where(eq(schema.sessions.projectId, projectId));
    for (const row of sessionRows) {
        sessionManager.deleteSession(row.id);
    }
    WorkspaceShellManager.deleteByProjectId(projectId);

    const deploymentRows = await db.select().from(schema.deployments)
        .where(eq(schema.deployments.projectId, projectId));
    for (const dep of deploymentRows) {
        await deploymentService.remove(userId, dep.id);
    }

    // 配套清理：销毁 boxlite/blink sessions 等 runtime 资源（local destroy 为 no-op）。
    // destroy 失败必须记录：静默忽略会留下孤儿 VM，其 workspace 目录随后被删后会导致
    // boxlite 初始化 panic（见 orphan-VM 故障）。失败的 runtime 记录保留，便于后续对账清理。
    const runtimeRows = await db.select().from(schema.runtimes)
        .where(eq(schema.runtimes.projectId, projectId));
    const { getRuntime } = require('../runtime/registry');
    const rt = getRuntime();
    const failedRuntimeRefs = [];
    for (const rrow of runtimeRows) {
        if (rrow.runtimeRef) {
            try {
                await rt.provider.destroy(rrow.runtimeRef);
            } catch (err) {
                failedRuntimeRefs.push(rrow.runtimeRef);
                if (log?.warn) {
                    log.warn({ err, projectId, runtimeRef: rrow.runtimeRef },
                        '[projects] failed to destroy runtime VM during project delete (orphan VM may remain)');
                }
            }
        }
    }

    await db.delete(schema.workspaceCheckpoints).where(eq(schema.workspaceCheckpoints.projectId, projectId));
    await db.delete(schema.repoSnapshots).where(eq(schema.repoSnapshots.projectId, projectId));
    await db.delete(schema.devEnvironmentProfiles).where(eq(schema.devEnvironmentProfiles.projectId, projectId));
    await db.delete(schema.mergeRequests).where(eq(schema.mergeRequests.projectId, projectId));
    await db.delete(schema.projectBranches).where(eq(schema.projectBranches.projectId, projectId));
    await db.delete(schema.sessions).where(eq(schema.sessions.projectId, projectId));
    await db.delete(schema.deployments).where(eq(schema.deployments.projectId, projectId));
    await db.delete(schema.runtimes).where(eq(schema.runtimes.projectId, projectId));
    await db.delete(schema.events).where(eq(schema.events.projectId, projectId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));

    const dir = workspace.projectDir(userId, projectId);
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }

    return { failedRuntimeRefs };
}

module.exports = { deleteProjectForUser };
