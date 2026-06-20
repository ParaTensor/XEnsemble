const path = require('path');
const fs = require('fs');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT
    || path.join(__dirname, '../data/workspaces');

function ensureWorkspaceRoot() {
    if (!fs.existsSync(WORKSPACE_ROOT)) {
        fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
    }
}

function projectDir(userId, projectId) {
    return path.join(WORKSPACE_ROOT, userId, projectId);
}

function createProjectDirectory(userId, projectId) {
    ensureWorkspaceRoot();
    const dir = projectDir(userId, projectId);
    fs.mkdirSync(dir, { recursive: true });
    const { ensurePreviewContractFile } = require('./runtime/previewContract');
    ensurePreviewContractFile(dir);
    return dir;
}

/** Resolve a relative path inside project root; returns null if traversal escapes jail. */
function resolveSafePath(rootDir, relativePath) {
    const root = path.resolve(rootDir);
    const trimmed = String(relativePath || '').replace(/^[/\\]+/, '');
    const safe = path.normalize(trimmed).replace(/^(\.\.(\/|\\\\|$))+/, '');
    const absolute = path.resolve(root, safe === '.' ? '' : safe);
    // Resolve symlinks to prevent symlink escape
    let realAbsolute;
    try {
        realAbsolute = fs.realpathSync.native(absolute);
    } catch (e) {
        // Path does not exist yet; use normalized absolute but ensure it stays under root
        realAbsolute = absolute;
    }
    const realRoot = fs.realpathSync.native(root);
    if (realAbsolute !== realRoot && !realAbsolute.startsWith(realRoot + path.sep)) {
        return null;
    }
    return absolute;
}

module.exports = {
    WORKSPACE_ROOT,
    ensureWorkspaceRoot,
    projectDir,
    createProjectDirectory,
    resolveSafePath,
};
