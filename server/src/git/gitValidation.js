const path = require('path');

function invalidInput(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function assertRepoRelativePath(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) {
        throw invalidInput('Invalid repository path');
    }
    const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
    if (
        path.posix.isAbsolute(normalized)
        || normalized === '..'
        || normalized.startsWith('../')
    ) {
        throw invalidInput('Repository path must stay inside the workspace');
    }
    return normalized;
}

function assertGitRef(ref) {
    if (ref == null || ref === '') return null;
    const value = String(ref);
    if (
        value.length > 256
        || value.startsWith('-')
        || /[\0-\x20\x7f]/.test(value)
        || value.includes('..')
        || value.includes('@{')
        || value.includes('\\')
    ) {
        throw invalidInput('Invalid Git ref');
    }
    return value;
}

function assertGitBranch(branch) {
    const value = assertGitRef(branch);
    if (!value || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock') || value.includes('//')) {
        throw invalidInput('Invalid Git branch name');
    }
    return value;
}

module.exports = {
    assertRepoRelativePath,
    assertGitRef,
    assertGitBranch,
};
