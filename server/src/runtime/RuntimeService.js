const crypto = require('crypto');
const { eq, and } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { getRuntime } = require('./registry');
const { RuntimeError } = require('./interfaces');
const { singleflight } = require('./singleflight');
const { recordEvent } = require('../events/recordEvent');
const PROVIDER = process.env.RUNTIME_PROVIDER || 'local';

function runtimeKey(projectId, runtimeId) {
    return `${projectId}:${runtimeId || 'default'}`;
}

/**
 * 确保 project 有 default runtime 记录并完成 provider provision / restore。
 * opts.baseSnapshotId / opts.checkpointId 预留给云 provider 恢复 repo snapshot 或 session checkpoint。
 * @returns {Promise<{ runtime: object, workspacePath: string, recoverable: boolean }>}
 */
async function ensureProjectRuntime(project, opts = {}) {
    const targetRuntimeId = opts.runtimeId || project.defaultRuntimeId;
    return singleflight(runtimeKey(project.id, targetRuntimeId), async () => {
        const rt = getRuntime();

        let runtimeRow = null;
        if (targetRuntimeId) {
            const rows = await db.select().from(schema.runtimes)
                .where(and(
                    eq(schema.runtimes.id, targetRuntimeId),
                    eq(schema.runtimes.projectId, project.id),
                ));
            if (rows.length === 0) {
                throw new RuntimeError('Runtime not found for this project', 404);
            }
            runtimeRow = rows[0];
        } else {
            const created = await getOrCreateDefaultRuntime(project);
            runtimeRow = created.runtime;
        }

        const provision = await rt.provider.ensureReady(project, {
            runtimeId: runtimeRow.id,
            baseSnapshotId: opts.baseSnapshotId,
            checkpointId: opts.checkpointId,
        });
        const workspacePath = provision.workspacePath;
        const now = Date.now();

        if (runtimeRow.endpoint !== workspacePath || runtimeRow.runtimeRef !== provision.runtimeRef) {
            await db.update(schema.runtimes).set({
                runtimeRef: provision.runtimeRef,
                endpoint: workspacePath,
                status: 'ready',
                updatedAt: now,
            }).where(eq(schema.runtimes.id, runtimeRow.id));
            runtimeRow = { ...runtimeRow, runtimeRef: provision.runtimeRef, endpoint: workspacePath, status: 'ready' };
        }

        if (project.serverPath !== workspacePath) {
            await db.update(schema.projects).set({ serverPath: workspacePath })
                .where(eq(schema.projects.id, project.id));
        }

        const attach = await rt.provider.attach(provision.runtimeRef);
        return {
            runtime: runtimeRow,
            workspacePath,
            recoverable: Boolean(attach?.recoverable),
        };
    });
}

async function getOrCreateDefaultRuntime(project) {
    if (project.defaultRuntimeId) {
        const rows = await db.select().from(schema.runtimes)
            .where(eq(schema.runtimes.id, project.defaultRuntimeId));
        if (rows.length > 0) {
            return {
                runtime: rows[0],
                workspacePath: rows[0].endpoint || project.serverPath,
                recoverable: false,
            };
        }
    }

    const rt = getRuntime();
    const provision = await rt.provider.ensureReady(project);
    const now = Date.now();
    const runtimeId = `rt_${crypto.randomBytes(6).toString('hex')}`;

    await db.insert(schema.runtimes).values({
        id: runtimeId,
        projectId: project.id,
        provider: PROVIDER,
        runtimeRef: provision.runtimeRef,
        role: 'default',
        status: 'ready',
        endpoint: provision.workspacePath,
        createdAt: now,
        updatedAt: now,
    });

    await db.update(schema.projects).set({
        defaultRuntimeId: runtimeId,
        serverPath: provision.workspacePath,
    }).where(eq(schema.projects.id, project.id));

    await recordEvent({
        userId: project.userId,
        projectId: project.id,
        subjectType: 'runtime',
        subjectId: runtimeId,
        type: 'ready',
        data: { provider: PROVIDER, role: 'default' },
    });

    const runtimeRow = {
        id: runtimeId,
        projectId: project.id,
        provider: PROVIDER,
        runtimeRef: provision.runtimeRef,
        role: 'default',
        status: 'ready',
        endpoint: provision.workspacePath,
    };

    return {
        runtime: runtimeRow,
        workspacePath: provision.workspacePath,
        recoverable: false,
    };
}

function formatRuntime(row) {
    if (!row) return null;
    return {
        id: row.id,
        project_id: row.projectId,
        provider: row.provider,
        runtime_ref: row.runtimeRef,
        role: row.role,
        status: row.status,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
    };
}

module.exports = {
    ensureProjectRuntime,
    getOrCreateDefaultRuntime,
    formatRuntime,
};
