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
    const input = String(relativePath || '');
    if (input.includes('\0')) return null;
    const trimmed = input.replace(/^[/\\]+/, '');
    const safe = path.normalize(trimmed).replace(/^(\.\.(\/|\\\\|$))+/, '');
    if (safe.startsWith('..')) return null;
    const absolute = path.resolve(root, safe === '.' ? '' : safe);

    let realRoot;
    try {
        realRoot = fs.realpathSync.native(root);
    } catch {
        realRoot = root;
    }

    // Resolve symlinks in the path. If the target does not exist, walk up to the
    // nearest existing ancestor, resolve that, and append the remaining suffix.
    let realAbsolute;
    let suffix = '';
    let current = absolute;
    while (true) {
        try {
            realAbsolute = fs.realpathSync.native(current);
            break;
        } catch {
            if (current === root || current === path.dirname(current)) {
                // Nothing above resolves; fall back to normalized absolute.
                realAbsolute = absolute;
                suffix = '';
                break;
            }
            suffix = path.basename(current) + (suffix ? path.sep + suffix : '');
            current = path.dirname(current);
        }
    }
    if (suffix) {
        realAbsolute = path.join(realAbsolute, suffix);
    }

    const realRootNorm = path.normalize(realRoot + path.sep);
    const realAbsNorm = path.normalize(realAbsolute);
    if (realAbsNorm !== realRoot && !realAbsNorm.startsWith(realRootNorm)) {
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
