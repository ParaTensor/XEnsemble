const { eq, and, lt } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { getRuntime } = require('../runtime/registry');
const { recordEvent } = require('../events/recordEvent');
const previewRegistry = require('../runtime/localPreviewRegistry');
const { probePort } = require('../runtime/previewHealth');
const { getPreviewPort } = require('../workspace/previewPorts');
const { projectDir } = require('../workspace');

const SCAN_MS = 60_000;

async function resolveWorkspacePath(row) {
    const projects = await db.select({ serverPath: schema.projects.serverPath })
        .from(schema.projects)
        .where(eq(schema.projects.id, row.projectId));
    const serverPath = projects[0]?.serverPath;
    if (serverPath) return serverPath;
    return projectDir(row.userId, row.projectId);
}

/** server 重启后尝试从 `.agents/ports.json` 恢复；否则将 DB 中 running preview 标为 stopped */
async function reconcileStaleRunningPreviews() {
    const rows = await db.select().from(schema.deployments)
        .where(and(
            eq(schema.deployments.kind, 'preview'),
            eq(schema.deployments.status, 'running'),
        ));

    const runtime = getRuntime();
    if (typeof runtime.provider?.ensureInitialized === 'function') {
        try { await runtime.provider.ensureInitialized(); } catch (err) {
            console.warn('[lifecycle] remote preview provider initialization failed:', err.message);
        }
    }
    for (const row of rows) {
        if (previewRegistry.get(row.id)) continue;

        // Remote providers (e.g. Blaxel) keep preview state inside the sandbox;
        // recover it through the provider instead of probing localhost.
        if (typeof runtime.preview?.recoverPreview === 'function') {
            const remoteEntry = await runtime.preview.recoverPreview(row);
            if (remoteEntry) {
                previewRegistry.set(row.id, remoteEntry, { publicUrl: row.publicUrl });
                continue;
            }
        }

        const workspacePath = await resolveWorkspacePath(row);
        const persisted = getPreviewPort(workspacePath, row.id);
        if (persisted?.port && await probePort('127.0.0.1', persisted.port)) {
            previewRegistry.set(row.id, {
                port: persisted.port,
                child: null,
                workspacePath,
                startedAt: persisted.started_at || Date.now(),
                recovered: true,
            }, { publicUrl: row.publicUrl || persisted.public_url });
            continue;
        }

        await db.update(schema.deployments).set({
            status: 'stopped',
            lastErrorMessage: 'Preview process lost after control plane restart',
            updatedAt: Date.now(),
        }).where(eq(schema.deployments.id, row.id));
    }
}

async function expirePreviews() {
    const now = Date.now();
    const rows = await db.select().from(schema.deployments)
        .where(and(
            eq(schema.deployments.kind, 'preview'),
            eq(schema.deployments.status, 'running'),
            lt(schema.deployments.expiresAt, now),
        ));

    const rt = getRuntime();
    for (const row of rows) {
        try {
            await rt.preview.stopPreview(row);
        } catch (_) { /* ignore */ }
        await db.update(schema.deployments).set({
            status: 'expired',
            previewTokenHash: null,
            updatedAt: now,
        }).where(eq(schema.deployments.id, row.id));

        await recordEvent({
            userId: row.userId,
            projectId: row.projectId,
            subjectType: 'deployment',
            subjectId: row.id,
            type: 'expired',
            data: {},
        });
    }
}

function startPreviewLifecycle() {
    reconcileStaleRunningPreviews().catch((err) => {
        console.error('[lifecycle] reconcile failed', err);
    });
    setInterval(() => {
        expirePreviews().catch((err) => console.error('[lifecycle] expire failed', err));
    }, SCAN_MS);
}

module.exports = { startPreviewLifecycle, reconcileStaleRunningPreviews, expirePreviews };
