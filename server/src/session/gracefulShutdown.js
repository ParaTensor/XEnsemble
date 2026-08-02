const transcriptStore = require('../runtime/TranscriptStore');
const { stopSession } = require('./idleHibernate');

/**
 * Best-effort graceful shutdown for control-plane process exit.
 * Memory handles are stopped; durable session rows stay recoverable via DB.
 */
async function gracefulShutdownSessions({
    db,
    schema,
    runtime,
    sessionManager,
    workspaceShellManager,
    fastifyLog,
    activeWebSockets = new Set(),
    closeCode = 1001,
}) {
    for (const ws of [...activeWebSockets]) {
        try {
            if (ws.readyState === 1 /* OPEN */) ws.close(closeCode, 'server shutting down');
        } catch (_) { /* ignore */ }
    }

    if (typeof workspaceShellManager?.deleteAll === 'function') {
        try {
            workspaceShellManager.deleteAll();
        } catch (_) { /* ignore */ }
    } else if (workspaceShellManager?.shells) {
        for (const shellId of [...workspaceShellManager.shells.keys()]) {
            try {
                workspaceShellManager.delete?.(shellId);
            } catch (_) { /* ignore */ }
        }
    }

    const live = typeof sessionManager?.listSessions === 'function'
        ? sessionManager.listSessions()
        : [];
    await Promise.all(live.map(async (session) => {
        try {
            await stopSession({
                db,
                schema,
                runtime,
                sessionManager,
                session,
                fastifyLog,
            });
        } catch (err) {
            fastifyLog?.warn?.(err, `[shutdown] failed to stop session ${session?.id}`);
        }
    }));

    try {
        if (typeof transcriptStore.flushAllSync === 'function') {
            transcriptStore.flushAllSync();
        } else if (typeof transcriptStore._flushAllStates === 'function') {
            transcriptStore._flushAllStates();
        }
    } catch (err) {
        fastifyLog?.warn?.(err, '[shutdown] transcript flush failed');
    }
}

function installProcessShutdownHooks(fastify, { timeoutMs = 10_000 } = {}) {
    let shuttingDown = false;
    const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        fastify.log?.info?.(`[shutdown] received ${signal}, closing`);
        const timer = setTimeout(() => {
            fastify.log?.error?.('[shutdown] timed out; forcing exit');
            process.exit(1);
        }, timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
        Promise.resolve(fastify.close())
            .then(() => process.exit(0))
            .catch((err) => {
                fastify.log?.error?.(err, '[shutdown] close failed');
                process.exit(1);
            });
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
}

module.exports = {
    gracefulShutdownSessions,
    installProcessShutdownHooks,
};
