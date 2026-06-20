const { eq, and, lt } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { getRuntime } = require('../runtime/registry');
const { recordEvent } = require('../events/recordEvent');
const previewRegistry = require('../runtime/localPreviewRegistry');

const SCAN_MS = 60_000;

/** server 重启后内存进程已失，将 DB 中 running preview 标为 stopped */
async function reconcileStaleRunningPreviews() {
    const rows = await db.select().from(schema.deployments)
        .where(and(
            eq(schema.deployments.kind, 'preview'),
            eq(schema.deployments.status, 'running'),
        ));

    for (const row of rows) {
        if (previewRegistry.get(row.id)) continue;
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
