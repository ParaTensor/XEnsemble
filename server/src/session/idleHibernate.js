const { eq } = require('drizzle-orm');

function shouldHibernateSession(session, now, thresholdMs, supportsHibernate) {
    if (!supportsHibernate || thresholdMs <= 0) return false;
    if (!session || session.status !== 'running' || !session.handle) return false;
    if ((session.activeTerminalSubscribers || 0) > 0) return false;
    const lastActivityAt = Number(session.lastActivityAt || session.lastOutputAt || session.lastAttachAt || session.createdAt || 0);
    if (!Number.isFinite(lastActivityAt)) return false;
    return (now - lastActivityAt) > thresholdMs;
}

async function maybeAutoCheckpointProject({ project, sessionId, fastifyLog }) {
    if (!project || project.workspaceMode !== 'git') return;
    try {
        const { GitOperationService } = require('../github/GitOperationService');
        const gitOps = new GitOperationService({ getToken: () => null });
        await gitOps.commitAll(project, `chore(xensemble): auto-checkpoint session ${sessionId}`);
    } catch (err) {
        fastifyLog?.warn?.(err, 'Failed to auto-checkpoint idle session');
    }
}

async function hibernateSession({
    db,
    schema,
    runtime,
    sessionManager,
    session,
    fastifyLog,
}) {
    if (!session || !sessionManager.isAlive(session.id)) return { hibernated: false, reason: 'not_alive' };
    if (!runtime?.provider?.supportsHibernate?.()) return { hibernated: false, reason: 'unsupported' };
    const runtimeRef = session.runtimeRef || session.runtimeId || session.handle?.runtimeRef || session.streamRef;
    if (!runtimeRef) return { hibernated: false, reason: 'missing_runtime_ref' };

    sessionManager.beginHibernate(session.id);
    try {
        await runtime.provider.hibernate(runtimeRef);
    } catch (err) {
        if (fastifyLog?.warn) fastifyLog.warn(err, '[sessions] failed to hibernate session runtime');
        sessionManager.cancelHibernate(session.id);
        return { hibernated: false, reason: 'provider_failed', error: err };
    }

    if (session.projectId) {
        const projectRows = await db.select().from(schema.projects).where(eq(schema.projects.id, session.projectId));
        await maybeAutoCheckpointProject({ project: projectRows[0] || null, sessionId: session.id, fastifyLog });
    }

    try {
        await db.update(schema.sessions)
            .set({
                status: 'idle',
                recoverable: session.recoverable,
                streamRef: session.streamRef || null,
                stateDirRef: session.stateDirRef || null,
            })
            .where(eq(schema.sessions.id, session.id));
    } catch (err) {
        fastifyLog?.warn?.(err, '[sessions] failed to persist idle status');
    }
    sessionManager.completeHibernate(session.id);

    return { hibernated: true };
}

function createIdleHibernateMonitor({
    db,
    schema,
    runtime,
    sessionManager,
    fastifyLog,
    idleThresholdMs,
    sweepIntervalMs,
    now = () => Date.now(),
}) {
    let timer = null;
    let stopped = false;
    const threshold = Number(idleThresholdMs);
    const interval = Number(sweepIntervalMs);
    const enabled = Number.isFinite(threshold) && threshold > 0;

    async function sweepOnce() {
        if (!enabled || stopped) {
            return { enabled, hibernated: 0 };
        }
        if (!runtime?.provider?.supportsHibernate?.()) {
            return { enabled, hibernated: 0, supported: false };
        }
        let hibernated = 0;
        const sessions = sessionManager.listSessions();
        for (const session of sessions) {
            if (!shouldHibernateSession(session, now(), threshold, true)) continue;
            const result = await hibernateSession({
                db,
                schema,
                runtime,
                sessionManager,
                session,
                fastifyLog,
            });
            if (result.hibernated) hibernated += 1;
        }
        return { enabled, hibernated, supported: true };
    }

    function start() {
        if (!enabled || timer || stopped) return;
        timer = setInterval(() => {
            sweepOnce().catch((err) => fastifyLog?.warn?.(err, '[sessions] idle hibernate sweep failed'));
        }, Number.isFinite(interval) && interval > 0 ? interval : 60000);
        if (typeof timer.unref === 'function') timer.unref();
    }

    function stop() {
        stopped = true;
        if (timer) clearInterval(timer);
        timer = null;
    }

    return { start, stop, sweepOnce, enabled };
}

module.exports = {
    shouldHibernateSession,
    hibernateSession,
    createIdleHibernateMonitor,
};
