const { test } = require('node:test');
const assert = require('node:assert/strict');

const { applyProjectGitEnv } = require('./projectGitEnv');

test('applyProjectGitEnv exposes generic external provider context', () => {
    const env = {};
    applyProjectGitEnv(env, {
        repoProvider: 'gitlab',
        currentBranch: 'xensemble/work',
        repoDefaultBranch: 'main',
        remoteFullName: 'group/project',
    });

    assert.deepEqual(env, {
        XENSEMBLE_GIT_BRANCH: 'xensemble/work',
        XENSEMBLE_GIT_BASE_BRANCH: 'main',
        XENSEMBLE_REPO_URL: 'group/project',
        XENSEMBLE_REPO_PROVIDER: 'gitlab',
    });
});

test('applyProjectGitEnv skips local-only projects', () => {
    const env = { KEEP: 'value' };
    applyProjectGitEnv(env, { repoProvider: 'local_git' });
    assert.deepEqual(env, { KEEP: 'value' });
});
