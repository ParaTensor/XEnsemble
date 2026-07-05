const { eq, isNull } = require('drizzle-orm');
const schema = require('./schema');
const workspace = require('../workspace');

const PROVIDER = process.env.RUNTIME_PROVIDER || 'local';

/** 为无 default_runtime_id 的历史 project 插入 default runtime（幂等）。 */
async function backfillDefaultRuntimes(db) {
    const projects = await db.select({
        id: schema.projects.id,
        userId: schema.projects.userId,
        serverPath: schema.projects.serverPath,
        defaultRuntimeId: schema.projects.defaultRuntimeId,
    }).from(schema.projects).where(isNull(schema.projects.defaultRuntimeId));

    const now = Date.now();
    for (const p of projects) {
        const runtimeId = `rt_def_${p.id}`;
        let endpoint = p.serverPath;
        if (!endpoint) {
            endpoint = workspace.createProjectDirectory(p.userId, p.id);
            await db.update(schema.projects)
                .set({ serverPath: endpoint })
                .where(eq(schema.projects.id, p.id));
        }
        await db.insert(schema.runtimes).values({
            id: runtimeId,
            projectId: p.id,
            provider: PROVIDER,
            runtimeRef: 'local',
            role: 'default',
            status: 'ready',
            endpoint,
            createdAt: now,
            updatedAt: now,
        }).onConflictDoNothing();
        await db.update(schema.projects)
            .set({ defaultRuntimeId: runtimeId })
            .where(eq(schema.projects.id, p.id));
    }
}

module.exports = { backfillDefaultRuntimes };
