const { eq } = require('drizzle-orm');
const { registerSessionLifecycle } = require('./resumeSession');

async function recoverRunningSessions({
    db,
    schema,
    runtime,
    sessionManager,
    transcriptStore,
    fastifyLog,
}) {
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

    const recovered = [];
    for (const session of running) {
        if (!session.streamRef || !String(session.streamRef).startsWith('boxlite:')) {
            continue;
        }
        if (!session.recoverable) {
            await db.update(schema.sessions)
                .set({ status: 'exited' })
                .where(eq(schema.sessions.id, session.id));
            continue;
        }

        const transcriptRows = await db.select().from(schema.sessionStreams)
            .where(eq(schema.sessionStreams.sessionId, session.id));
        const transcriptRef = transcriptRows[0]?.storageRef || session.streamRef || null;
        if (!transcriptRef) {
            await db.update(schema.sessions)
                .set({ status: 'exited' })
                .where(eq(schema.sessions.id, session.id));
            continue;
        }

        const cursor = transcriptStore.reattachCursor(transcriptRef);
        if (cursor == null) {
            await db.update(schema.sessions)
                .set({ status: 'exited' })
                .where(eq(schema.sessions.id, session.id));
            continue;
        }

        const projectRows = session.projectId
            ? await db.select().from(schema.projects).where(eq(schema.projects.id, session.projectId))
            : [];
        const project = projectRows[0] || null;
        if (!project) {
            await db.update(schema.sessions)
                .set({ status: 'exited' })
                .where(eq(schema.sessions.id, session.id));
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
            await db.update(schema.sessions)
                .set({ status: 'exited' })
                .where(eq(schema.sessions.id, session.id));
        }
    }

    return { recovered: recovered.length, sessions: recovered };
}

module.exports = { recoverRunningSessions };
