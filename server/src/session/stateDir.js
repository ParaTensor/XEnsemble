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

module.exports = {
    buildSessionStateDirRef,
    ensureSessionStateDir,
    sessionStateDirExists,
};
