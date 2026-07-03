const WORKSPACE_SHELL_IDLE_MS = Number(process.env.WORKSPACE_SHELL_IDLE_MS) || 30 * 60 * 1000;

class WorkspaceShellManager {
    constructor() {
        this.shells = new Map();
    }

    create(shellId, handle) {
        const shell = {
            handle,
            history: '',
            status: 'running',
            exitCode: null,
            exitListeners: new Set(),
            subscribers: 0,
            idleTimer: null,
        };

        handle.onData((data) => {
            shell.history += data;
            if (shell.history.length > 100000) {
                shell.history = shell.history.slice(-100000);
            }
        });

        handle.onExit(({ exitCode, signal }) => {
            const entry = this.shells.get(shellId);
            if (!entry) return;
            entry.status = 'exited';
            entry.exitCode = exitCode ?? signal ?? null;
            if (entry.idleTimer) {
                clearTimeout(entry.idleTimer);
                entry.idleTimer = null;
            }
            for (const listener of entry.exitListeners) {
                try {
                    listener(entry.exitCode);
                } catch (_) {
                    /* ignore */
                }
            }
            entry.exitListeners.clear();
            this.shells.delete(shellId);
        });

        this.shells.set(shellId, shell);
        return shell;
    }

    get(shellId) {
        return this.shells.get(shellId);
    }

    isAlive(shellId) {
        const shell = this.shells.get(shellId);
        return Boolean(shell && shell.status === 'running' && shell.handle);
    }

    onExit(shellId, listener) {
        const shell = this.shells.get(shellId);
        if (!shell) return () => {};
        if (shell.status === 'exited') {
            listener(shell.exitCode);
            return () => {};
        }
        shell.exitListeners.add(listener);
        return () => shell.exitListeners.delete(listener);
    }

    delete(shellId) {
        const shell = this.shells.get(shellId);
        if (!shell) return;
        if (shell.idleTimer) {
            clearTimeout(shell.idleTimer);
            shell.idleTimer = null;
        }
        if (shell.handle) {
            try {
                shell.handle.kill();
            } catch (e) {
                console.error(`Kill workspace shell error: ${e.message}`);
            }
        }
        this.shells.delete(shellId);
    }

    deleteByProjectId(projectId) {
        const suffix = `:${projectId}`;
        for (const shellId of [...this.shells.keys()]) {
            if (shellId.endsWith(suffix)) {
                this.delete(shellId);
            }
        }
    }

    addSubscriber(shellId) {
        const shell = this.shells.get(shellId);
        if (!shell) return;
        shell.subscribers += 1;
        if (shell.idleTimer) {
            clearTimeout(shell.idleTimer);
            shell.idleTimer = null;
        }
    }

    removeSubscriber(shellId) {
        const shell = this.shells.get(shellId);
        if (!shell) return;
        shell.subscribers = Math.max(0, shell.subscribers - 1);
        if (shell.subscribers !== 0 || shell.status !== 'running') return;
        if (shell.idleTimer) clearTimeout(shell.idleTimer);
        shell.idleTimer = setTimeout(() => {
            this.delete(shellId);
        }, WORKSPACE_SHELL_IDLE_MS);
    }
}

const manager = new WorkspaceShellManager();

function subscribeWorkspaceShell(shellId, send) {
    const shell = manager.get(shellId);
    if (!shell) {
        send({ type: 'error', data: 'Workspace shell not found. The backend may have restarted.' });
        return { ok: false, cleanup: () => {} };
    }
    if (!manager.isAlive(shellId)) {
        send({ type: 'error', data: 'This workspace shell has ended. Open Shell again to start a new one.' });
        return { ok: false, cleanup: () => {} };
    }

    if (shell.history) {
        send({ type: 'output', data: shell.history });
    }

    let cleaned = false;
    let offExit = () => {};
    let dataListener = null;
    let metricsInterval = null;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        offExit();
        if (dataListener?.dispose) dataListener.dispose();
        if (metricsInterval) clearInterval(metricsInterval);
    };

    dataListener = shell.handle.onData((data) => {
        send({ type: 'output', data });
    });

    metricsInterval = setInterval(async () => {
        if (!manager.isAlive(shellId)) return;
        try {
            const stats = await shell.handle.getMetrics();
            send({ type: 'metrics', data: stats });
        } catch (_) {
            /* ignore metrics errors */
        }
    }, 3000);

    offExit = manager.onExit(shellId, (exitCode) => {
        send({
            type: 'exit',
            data: exitCode,
            message: `\r\n\x1b[33m[Workspace shell ended with code ${exitCode ?? 'unknown'}]\x1b[0m\r\n`,
        });
        cleanup();
    });

    return { ok: true, cleanup, handle: shell.handle };
}

module.exports = {
    WorkspaceShellManager: manager,
    subscribeWorkspaceShell,
};
