const sessionManager = require('./SessionManager');

function resolveLiveSession(sessionId) {
    const session = sessionManager.getSession(sessionId);
    if (!session) {
        return {
            ok: false,
            error: 'Session not found. The backend may have restarted — use Restart to reconnect.',
        };
    }
    if (!sessionManager.isAlive(sessionId)) {
        return {
            ok: false,
            error: 'This session has ended. Launch a new agent instead of reconnecting to an old one.',
        };
    }
    return { ok: true, session, handle: session.handle };
}

function applyTerminalMessage(handle, msg) {
    if (msg.type === 'input') {
        handle.write(msg.data);
        return;
    }
    if (msg.type === 'resize') {
        try {
            handle.resize(msg.cols, msg.rows);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            if (!/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(errorMsg)) {
                console.error('PTY Resize Error:', errorMsg);
            }
        }
    }
}

/**
 * Subscribe to PTY output/metrics/exit for a session. Used by WS and HTTP (SSE) transports.
 * @param {string} sessionId
 * @param {(payload: object) => void} send
 * @returns {{ ok: boolean, cleanup: () => void, handle?: object }}
 */
function subscribeTerminal(sessionId, send) {
    const resolved = resolveLiveSession(sessionId);
    if (!resolved.ok) {
        send({ type: 'error', data: resolved.error });
        return { ok: false, cleanup: () => {} };
    }

    const { session, handle } = resolved;

    if (session.history) {
        send({ type: 'output', data: session.history });
    }

    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        offExit();
        dataListener.dispose();
        clearInterval(metricsInterval);
    };

    const dataListener = handle.onData((data) => {
        send({ type: 'output', data });
    });

    const metricsInterval = setInterval(async () => {
        if (!sessionManager.isAlive(sessionId)) return;
        try {
            const stats = await handle.getMetrics();
            send({ type: 'metrics', data: stats });
        } catch (_) { /* ignore metrics errors */ }
    }, 3000);

    const offExit = sessionManager.onExit(sessionId, (exitCode) => {
        send({
            type: 'exit',
            data: exitCode,
            message: `\r\n\x1b[33m[Session ended with code ${exitCode ?? 'unknown'}]\x1b[0m\r\n`,
        });
        cleanup();
    });

    return { ok: true, cleanup, handle };
}

module.exports = {
    resolveLiveSession,
    applyTerminalMessage,
    subscribeTerminal,
};
