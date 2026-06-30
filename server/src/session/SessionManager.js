const { removeScrollback } = require('../runtime/LocalScrollbackBuffer');
const titleService = require('./titleService');

const TITLE_HISTORY_THRESHOLD = Number(process.env.SESSION_TITLE_HISTORY_THRESHOLD) || 200;
const TITLE_DEBOUNCE_MS = Number(process.env.SESSION_TITLE_DEBOUNCE_MS) || 5000;
const TITLE_EXIT_MIN_HISTORY = 30;

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
            titleGenerated: false,
            titleTimeout: null,
        };

        let scrollback = '';
        if (handle && handle.streamRef && typeof handle.streamRef === 'string' && handle.streamRef.startsWith('local:')) {
            scrollback = require('../runtime/LocalScrollbackBuffer').readScrollback(handle.streamRef);
        }
        session.history = scrollback;

        handle.onData((data) => {
            session.history += data;
            if (session.history.length > 100000) {
                session.history = session.history.slice(-100000);
            }
            this._scheduleTitleGeneration(sessionId);
        });

        handle.onExit(({ exitCode, signal }) => {
            session.status = 'exited';
            session.exitCode = exitCode ?? signal ?? null;
            this._maybeGenerateTitleOnExit(sessionId);
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
        if (session) {
            if (session.titleTimeout) {
                clearTimeout(session.titleTimeout);
                session.titleTimeout = null;
            }
            if (session.handle) {
                try {
                    session.handle.kill();
                } catch (e) {
                    console.error(`Kill process error: ${e.message}`);
                }
                try {
                    const sr = session.handle.streamRef;
                    if (sr && typeof sr === 'string' && sr.startsWith('local:')) {
                        removeScrollback(sr);
                    }
                } catch (e) {
                    console.error(`Remove scrollback error: ${e.message}`);
                }
            }
        }
        this.sessions.delete(sessionId);
    }

    _scheduleTitleGeneration(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || session.titleGenerated) return;
        if (session.history.length < TITLE_HISTORY_THRESHOLD) return;

        if (session.titleTimeout) {
            clearTimeout(session.titleTimeout);
        }
        session.titleTimeout = setTimeout(() => {
            session.titleTimeout = null;
            titleService.generateSessionTitle(sessionId)
                .then((title) => {
                    if (title) session.titleGenerated = true;
                })
                .catch((err) => {
                    console.error(`Generate session title error: ${err.message}`);
                });
        }, TITLE_DEBOUNCE_MS);
    }

    _maybeGenerateTitleOnExit(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || session.titleGenerated) return;
        if ((session.history || '').length < TITLE_EXIT_MIN_HISTORY) return;

        titleService.generateSessionTitle(sessionId)
            .then((title) => {
                if (title) session.titleGenerated = true;
            })
            .catch((err) => {
                console.error(`Generate session title on exit error: ${err.message}`);
            });
    }
}

module.exports = new SessionManager();
