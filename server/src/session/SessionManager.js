class SessionManager {
    constructor() {
        this.sessions = new Map(); // [sessionId, { ptyProcess, agentId, createdAt, history }]
    }

    createSession(sessionId, ptyProcess, agentId) {
        const session = {
            ptyProcess,
            agentId,
            createdAt: Date.now(),
            history: '' // 简易历史回放 Buffer
        };

        // 持续记录 PTY 输出
        ptyProcess.onData((data) => {
            session.history += data;
            // 限制 Buffer 大小，防止内存泄漏 (保留最后的 100KB)
            if (session.history.length > 100000) {
                session.history = session.history.slice(-100000);
            }
        });

        this.sessions.set(sessionId, session);
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
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
