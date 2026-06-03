class SessionManager {
    constructor() {
        this.sessions = new Map(); // 存储格式: [sessionId, { ptyProcess, agentId, createdAt }]
    }

    createSession(sessionId, ptyProcess, agentId) {
        this.sessions.set(sessionId, {
            ptyProcess,
            agentId,
            createdAt: Date.now()
        });
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }

    deleteSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.ptyProcess) {
            const pid = session.ptyProcess.pid;
            try {
                // emdash source: kill the process group to ensure child processes are also terminated
                if (process.platform !== 'win32' && Number.isInteger(pid) && pid > 0) {
                    try {
                        process.kill(-pid, 'SIGTERM');
                    } catch (e) {}
                    setTimeout(() => {
                        try {
                            process.kill(-pid, 'SIGKILL');
                        } catch (e) {}
                    }, 2000);
                }
                session.ptyProcess.kill(); // 彻底销毁子进程
            } catch (e) {
                console.error(`Kill process error: ${e.message}`);
            }
        }
        this.sessions.delete(sessionId);
    }
}

module.exports = new SessionManager();
