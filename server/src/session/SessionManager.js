const { removeScrollback } = require('../runtime/LocalScrollbackBuffer');

/**
 * SessionManager — 管理活跃 agent session 的 bridge handle 与转发缓存。
 *
 * handle 为 StreamHandle（见 runtime/interfaces.js），不再假设 node-pty；
 * 进程清理、平台差异等均由 handle.kill() 内部处理。
 * history 仅为控制面易失缓存，事实来源在 runtime 侧（见 Architecture.md 3.2）。
 */
class SessionManager {
    constructor() {
        this.sessions = new Map();
    }

    createSession(sessionId, handle, agentId) {
        const session = {
            handle,
            agentId,
            createdAt: Date.now(),
            history: '',
            status: 'running',
            exitCode: null,
            exitListeners: new Set(),
        };

        const scrollback = require('../runtime/LocalScrollbackBuffer').readScrollback(handle.streamRef);
        session.history = scrollback;

        handle.onData((data) => {
            session.history += data;
            if (session.history.length > 100000) {
                session.history = session.history.slice(-100000);
            }
        });

        handle.onExit(({ exitCode, signal }) => {
            session.status = 'exited';
            session.exitCode = exitCode ?? signal ?? null;
            for (const listener of session.exitListeners) {
                try { listener(session.exitCode); } catch (_) { /* ignore */ }
            }
            session.exitListeners.clear();
        });

        this.sessions.set(sessionId, session);
        return session;
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    isAlive(sessionId) {
        const session = this.sessions.get(sessionId);
        return Boolean(session && session.status === 'running' && session.handle);
    }

    onExit(sessionId, listener) {
        const session = this.sessions.get(sessionId);
        if (!session) return () => {};
        if (session.status === 'exited') {
            listener(session.exitCode);
            return () => {};
        }
        session.exitListeners.add(listener);
        return () => session.exitListeners.delete(listener);
    }

    deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.handle) {
            try {
                session.handle.kill();
            } catch (e) {
                console.error(`Kill process error: ${e.message}`);
            }
            try {
                removeScrollback(session.handle.streamRef);
            } catch (e) {
                console.error(`Remove scrollback error: ${e.message}`);
            }
        }
        this.sessions.delete(sessionId);
    }
}

module.exports = new SessionManager();
