const fs = require('fs');
const path = require('path');

const { projectDir, resolveSafePath } = require('../workspace');

function buildSessionStateDirRef(sessionId) {
    return path.join('.xensemble', 'state', sessionId);
}

function resolveSessionStateDir(userId, projectId, sessionId) {
    const rootDir = projectDir(userId, projectId);
    const stateDirRef = buildSessionStateDirRef(sessionId);
    const stateDirPath = resolveSafePath(rootDir, stateDirRef);
    if (!stateDirPath) {
        return null;
    }
    return { stateDirRef, stateDirPath };
}

function ensureSessionStateDir(userId, projectId, sessionId) {
    const resolved = resolveSessionStateDir(userId, projectId, sessionId);
    if (!resolved) {
        return null;
    }
    fs.mkdirSync(resolved.stateDirPath, { recursive: true });
    return resolved;
}

module.exports = {
    buildSessionStateDirRef,
    resolveSessionStateDir,
    ensureSessionStateDir,
};
