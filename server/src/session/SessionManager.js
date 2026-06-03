class SessionManager {
    constructor() {
        this.sessions = new Map();
    }

    createSession(sessionId, ptyProcess, agentId) {
        const session = {
            ptyProcess,
            agentId,
            createdAt: Date.now(),
            history: '',
            status: 'running',
            exitCode: null,
            exitListeners: new Set(),
        };

        ptyProcess.onData((data) => {
            session.history += data;
            if (session.history.length > 100000) {
                session.history = session.history.slice(-100000);
            }
        });

        ptyProcess.onExit(({ exitCode, signal }) => {
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
        return Boolean(session && session.status === 'running' && session.ptyProcess);
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
        if (session && session.ptyProcess) {
            const pid = session.ptyProcess.pid;
            try {
                if (process.platform !== 'win32' && Number.isInteger(pid) && pid > 0) {
                    try { process.kill(-pid, 'SIGTERM'); } catch (e) {}
                    setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch (e) {} }, 2000);
                }
                session.ptyProcess.kill();
            } catch (e) {
                console.error(`Kill process error: ${e.message}`);
            }
        }
        this.sessions.delete(sessionId);
    }
}

module.exports = new SessionManager();
