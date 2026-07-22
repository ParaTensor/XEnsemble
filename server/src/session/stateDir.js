const { buildSessionStateDirRef } = require('./stateDirRef');

async function ensureSessionStateDir(fsAdapter, { workspaceRoot, sessionId, runtimeRef }) {
    if (!fsAdapter || typeof fsAdapter.resolveStateDir !== 'function') {
        return null;
    }
    const resolved = fsAdapter.resolveStateDir(workspaceRoot, sessionId);
    if (!resolved) {
        return null;
    }
    await fsAdapter.mkdirp(workspaceRoot, resolved.stateDirRef, { runtimeRef });
    return resolved;
}

async function sessionStateDirExists(fsAdapter, { workspaceRoot, sessionId, runtimeRef, stateDirRef }) {
    if (!fsAdapter || typeof fsAdapter.exists !== 'function') {
        return false;
    }
    const ref = stateDirRef || buildSessionStateDirRef(sessionId);
    return fsAdapter.exists(workspaceRoot, ref, { runtimeRef });
}

/**
 * Prepare a state directory for HOME redirection.
 * Creates a .bashrc that sources the original /root/.bashrc so that
 * `bash -ic` (used by BoxLiteExecAdapter.spawn) can still load user
 * customizations when HOME is redirected to the per-session state dir.
 */
async function prepareHomeRedirect(fsAdapter, { workspaceRoot, stateDirRef, runtimeRef }) {
    if (!fsAdapter || typeof fsAdapter.exists !== 'function') return;
    const bashrcRef = `${stateDirRef}/.bashrc`;
    const exists = await fsAdapter.exists(workspaceRoot, bashrcRef, { runtimeRef }).catch(() => false);
    if (exists) return;
    const content = 'source /root/.bashrc 2>/dev/null || true\n';
    if (typeof fsAdapter.fsWrite === 'function') {
        await fsAdapter.fsWrite(workspaceRoot, bashrcRef, content, { runtimeRef }).catch(() => {});
    }
}

module.exports = {
    buildSessionStateDirRef,
    ensureSessionStateDir,
    sessionStateDirExists,
    prepareHomeRedirect,
};
