const { readScrollback, removeScrollback } = require('../runtime/LocalScrollbackBuffer');
const transcriptStore = require('../runtime/TranscriptStore');
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
            streamRef: handle?.streamRef || null,
            createdAt: Date.now(),
            history: '',
            status: 'running',
            exitCode: null,
            exitSeq: null,
            exitListeners: new Set(),
            outputListeners: new Set(),
            titleGenerated: false,
            titleTimeout: null,
        };

        transcriptStore.bindSession(sessionId, session.streamRef);
        session.history = this._loadInitialHistory(session.streamRef);

        handle.onData((data) => {
            const frame = session.streamRef
                ? transcriptStore.append(session.streamRef, { kind: 'out', data })
                : null;
            session.history += data;
            if (session.history.length > 100000) {
                session.history = session.history.slice(-100000);
            }
            if (frame) {
                for (const listener of session.outputListeners) {
                    try { listener({ data, seq: frame.seq, kind: 'out' }); } catch (_) { /* ignore */ }
                }
            } else {
                for (const listener of session.outputListeners) {
                    try { listener({ data, seq: null, kind: 'out' }); } catch (_) { /* ignore */ }
                }
            }
            this._scheduleTitleGeneration(sessionId);
        });

        handle.onExit(({ exitCode, signal }) => {
            session.status = 'exited';
            session.exitCode = exitCode ?? signal ?? null;
            const exitFrame = session.streamRef
                ? transcriptStore.append(session.streamRef, { kind: 'exit', data: { code: session.exitCode } })
                : null;
            session.exitSeq = exitFrame ? exitFrame.seq : null;
            this._maybeGenerateTitleOnExit(sessionId);
            for (const listener of session.exitListeners) {
                try { listener(session.exitCode, session.exitSeq); } catch (_) { /* ignore */ }
            }
            session.exitListeners.clear();
            session.outputListeners.clear();
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
            listener(session.exitCode, session.exitSeq);
            return () => {};
        }
        session.exitListeners.add(listener);
        return () => session.exitListeners.delete(listener);
    }

    subscribeOutput(sessionId, listener) {
        const session = this.sessions.get(sessionId);
        if (!session) return () => {};
        if (session.status !== 'running') return () => {};
        session.outputListeners.add(listener);
        return () => session.outputListeners.delete(listener);
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
                    if (sr && typeof sr === 'string') {
                        transcriptStore.remove(sr);
                        if (sr.startsWith('local:')) {
                            removeScrollback(sr);
                        }
                    }
                } catch (e) {
                    console.error(`Remove transcript error: ${e.message}`);
                }
            }
        }
        this.sessions.delete(sessionId);
    }

    _loadInitialHistory(streamRef) {
        if (!streamRef) return '';
        const transcriptFrames = transcriptStore.readFrom(streamRef, 0);
        if (transcriptFrames.length > 0) {
            return transcriptFrames
                .filter((frame) => frame.kind === 'out' || frame.kind === 'in')
                .map((frame) => (typeof frame.data === 'string' ? frame.data : ''))
                .join('');
        }
        if (typeof streamRef === 'string' && streamRef.startsWith('local:')) {
            return readScrollback(streamRef);
        }
        return '';
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
