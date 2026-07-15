const { eq, sql } = require('drizzle-orm');
const { registerSessionLifecycle } = require('./resumeSession');
const { isSessionRecoverable } = require('../agents/agentResume');

async function recoverRunningSessions({
    db,
    schema,
    runtime,
    sessionManager,
    transcriptStore,
    fastifyLog,
}) {
    // Mark sessions left in 'pending' state as 'failed' — the async provisioning
    // was interrupted by a server restart and cannot be resumed.
    const pending = await db.select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(eq(schema.sessions.status, 'pending'));
    for (const session of pending) {
        await db.update(schema.sessions).set({
            status: 'failed',
        }).where(eq(schema.sessions.id, session.id));
        try {
            await db.execute(sql`UPDATE sessions SET provisioning_error = ${'Server restarted during session provisioning'} WHERE id = ${session.id}`);
        } catch {}
        fastifyLog.warn({ sessionId: session.id }, '[sessions] marked pending session as failed after restart');
    }

    const running = await db.select({
        id: schema.sessions.id,
        userId: schema.sessions.userId,
        projectId: schema.sessions.projectId,
        runtimeId: schema.sessions.runtimeId,
        agentId: schema.sessions.agentId,
        cwd: schema.sessions.cwd,
        streamRef: schema.sessions.streamRef,
        stateDirRef: schema.sessions.stateDirRef,
        recoverable: schema.sessions.recoverable,
        status: schema.sessions.status,
    })
        .from(schema.sessions)
        .where(eq(schema.sessions.status, 'running'));

    // A session left `running` after a control-plane restart cannot keep a live
    // in-memory handle. If it is recoverable (L2 agent + persisted state dir), demote
    // it to `idle` so the user can resume it later; only genuinely non-recoverable
    // sessions are terminated as `exited`.
    const settleUnrecovered = async (session) => {
        const status = isSessionRecoverable(session) ? 'idle' : 'exited';
        await db.update(schema.sessions)
            .set({ status })
            .where(eq(schema.sessions.id, session.id));
    };

    const recovered = [];
    for (const session of running) {
        if (!session.streamRef || !String(session.streamRef).startsWith('boxlite:')) {
            continue;
        }
        if (!session.recoverable) {
            await settleUnrecovered(session);
            continue;
        }

        const transcriptRows = await db.select().from(schema.sessionStreams)
            .where(eq(schema.sessionStreams.sessionId, session.id));
        const transcriptRef = transcriptRows[0]?.storageRef || session.streamRef || null;
        if (!transcriptRef) {
            await settleUnrecovered(session);
            continue;
        }

        const cursor = transcriptStore.reattachCursor(transcriptRef);
        if (cursor == null) {
            await settleUnrecovered(session);
            continue;
        }

        const projectRows = session.projectId
            ? await db.select().from(schema.projects).where(eq(schema.projects.id, session.projectId))
            : [];
        const project = projectRows[0] || null;
        if (!project) {
            await settleUnrecovered(session);
            continue;
        }

        try {
            const handle = await runtime.provider.attachSession(session.id, session.streamRef, { after: cursor });
            if (!handle || typeof handle.onData !== 'function' || typeof handle.onExit !== 'function') {
                throw new Error('runtime attachSession did not return a stream handle');
            }
            const runtimeRows = session.runtimeId
                ? await db.select().from(schema.runtimes).where(eq(schema.runtimes.id, session.runtimeId))
                : [];
            sessionManager.createSession(session.id, handle, session.agentId, {
                transcriptRef,
                projectId: session.projectId || null,
                runtimeId: session.runtimeId || null,
                runtimeRef: runtimeRows[0]?.runtimeRef || session.runtimeId || null,
                stateDirRef: session.stateDirRef || null,
                userId: session.userId || null,
            });
            await registerSessionLifecycle({
                db,
                schema,
                sessionManager,
                sessionId: session.id,
                project,
                fastifyLog,
            });
            await db.update(schema.sessions)
                .set({
                    status: 'running',
                    streamRef: handle.streamRef || session.streamRef || null,
                    recoverable: true,
                })
                .where(eq(schema.sessions.id, session.id));
            recovered.push({
                sessionId: session.id,
                streamRef: handle.streamRef || session.streamRef || null,
                cursor,
            });
        } catch (err) {
            fastifyLog.warn({ err, sessionId: session.id }, '[sessions] failed to reattach running boxlite session');
            await settleUnrecovered(session);
        }
    }

    return { recovered: recovered.length, sessions: recovered };
}

module.exports = { recoverRunningSessions };
