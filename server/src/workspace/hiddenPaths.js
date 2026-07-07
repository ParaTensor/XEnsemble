const HIDDEN_WORKSPACE_DIRS = new Set(['.agents', '.git', '.xensemble', '.scrollback']);

function isHiddenWorkspacePath(relativePath) {
    const segments = String(relativePath || '').split('/').filter(Boolean);
    return segments.some((seg) => HIDDEN_WORKSPACE_DIRS.has(seg));
}

module.exports = { HIDDEN_WORKSPACE_DIRS, isHiddenWorkspacePath };
