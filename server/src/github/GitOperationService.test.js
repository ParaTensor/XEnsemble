const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { GitOperationService, GitError } = require('./GitOperationService');
const {
    stripCredentialFromUrl,
    createAskpassScript,
    removeAskpassScript,
    buildCredentialEnv,
} = require('./gitCredentialHelper');

function hasGit() {
    return spawnSync('git', ['--version']).status === 0;
}

function makeMockExec(handler = () => '') {
    const calls = [];
    const fn = async (cmd, args, env, options) => {
        calls.push({ cmd, args, env, options });
        const out = typeof handler === 'function' ? handler(args) : '';
        return { exitCode: 0, stdout: out ?? '', stderr: '' };
    };
    fn.calls = calls;
    return fn;
}

function findCall(calls, ...prefix) {
    return calls.find((c) => prefix.every((arg, i) => c.args[i] === arg));
}

describe('gitCredentialHelper', () => {
    it('stripCredentialFromUrl removes embedded credentials', () => {
        assert.strictEqual(
            stripCredentialFromUrl('https://user:pass@github.com/owner/repo.git'),
            'https://github.com/owner/repo.git',
        );
    });

    it('stripCredentialFromUrl leaves plain https URLs untouched', () => {
        assert.strictEqual(
            stripCredentialFromUrl('https://github.com/owner/repo.git'),
            'https://github.com/owner/repo.git',
        );
    });

    it('stripCredentialFromUrl leaves SSH-style URLs untouched', () => {
        assert.strictEqual(
            stripCredentialFromUrl('git@github.com:owner/repo.git'),
            'git@github.com:owner/repo.git',
        );
    });

    it('createAskpassScript writes an executable helper that echoes the token', () => {
        const token = 'gho_super_secret';
        const scriptPath = createAskpassScript(token);
        try {
            assert.ok(fs.existsSync(scriptPath));
            const stats = fs.statSync(scriptPath);
            assert.ok(stats.mode & 0o100, 'script should be executable');

            const result = spawnSync('/bin/sh', [scriptPath], {
                env: { ...process.env, GIT_ASKPASS_TOKEN: token },
                encoding: 'utf8',
            });
            assert.strictEqual(result.status, 0);
            assert.strictEqual(result.stdout.trim(), token);
        } finally {
            removeAskpassScript(scriptPath);
        }
        assert.ok(!fs.existsSync(scriptPath));
    });

    it('buildCredentialEnv returns GIT_ASKPASS env and a cleanup function', () => {
        const token = 'token_123';
        const { env, cleanup } = buildCredentialEnv(token);
        try {
            assert.ok(env.GIT_ASKPASS);
            assert.ok(env.GIT_ASKPASS.endsWith('.sh'));
            assert.strictEqual(env.GIT_ASKPASS_TOKEN, token);
            assert.ok(fs.existsSync(env.GIT_ASKPASS));
        } finally {
            cleanup();
        }
        assert.ok(!fs.existsSync(env.GIT_ASKPASS));
    });
});

describe('GitOperationService (mock exec)', () => {
    function createService(exec) {
        return new GitOperationService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: '/workspace' }),
            getToken: async () => 'mock_token',
        });
    }

    it('cloneRepo initializes, adds remote, fetches and checks out a branch', async () => {
        const exec = makeMockExec((args) => {
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
                return 'clone-sha\n';
            }
            return '';
        });
        const service = createService(exec);

        const result = await service.cloneRepo(
            { id: 'p1' },
            {
                repoUrl: 'https://TOKEN:x-oauth-basic@github.com/owner/repo.git',
                branch: 'main',
                depth: 1,
            },
        );

        assert.deepStrictEqual(result, { sha: 'clone-sha', branch: 'main' });

        assert.ok(findCall(exec.calls, 'init'));

        const remoteCall = findCall(exec.calls, 'remote', 'add', 'origin');
        assert.ok(remoteCall, 'remote add origin should be called');
        assert.strictEqual(
            remoteCall.args[3],
            'https://github.com/owner/repo.git',
            'remote URL should not contain the token',
        );
        assert.ok(remoteCall.env.GIT_ASKPASS);
        assert.strictEqual(remoteCall.env.GIT_ASKPASS_TOKEN, 'mock_token');

        const fetchCall = findCall(exec.calls, 'fetch', 'origin');
        assert.ok(fetchCall);
        assert.deepStrictEqual(fetchCall.args.slice(2), ['main', '--depth', '1']);

        const checkoutCall = findCall(exec.calls, 'checkout', '-b', 'main');
        assert.ok(checkoutCall);
        assert.strictEqual(checkoutCall.args[3], 'origin/main');
    });

    it('cloneRepo updates existing remote origin', async () => {
        let remoteAddFailed = false;
        const exec = makeMockExec((args) => {
            if (args[0] === 'remote' && args[1] === 'add') {
                if (!remoteAddFailed) {
                    remoteAddFailed = true;
                    return { exitCode: 3, stdout: '', stderr: 'fatal: remote origin already exists' };
                }
            }
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
                return 'abc123\n';
            }
            return '';
        });
        // makeMockExec always returns exitCode 0; simulate a non-zero response manually.
        const failingExec = async (cmd, args, env, options) => {
            if (args[0] === 'remote' && args[1] === 'add' && !remoteAddFailed) {
                remoteAddFailed = true;
                return { exitCode: 3, stdout: '', stderr: 'fatal: remote origin already exists' };
            }
            return exec(cmd, args, env, options);
        };
        failingExec.calls = exec.calls;

        const service = createService(failingExec);
        await service.cloneRepo({ id: 'p2' }, { repoUrl: 'https://github.com/owner/repo.git', branch: 'dev' });

        const setUrlCall = findCall(exec.calls, 'remote', 'set-url', 'origin');
        assert.ok(setUrlCall);
        assert.strictEqual(setUrlCall.args[3], 'https://github.com/owner/repo.git');
    });

    it('createBranch checks out a new branch and returns its sha', async () => {
        const exec = makeMockExec((args) => {
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
                return 'branch-sha\n';
            }
            return '';
        });
        const service = createService(exec);

        const result = await service.createBranch({ id: 'p1' }, 'feature', 'main');
        assert.deepStrictEqual(result, { branch: 'feature', sha: 'branch-sha' });

        const call = findCall(exec.calls, 'checkout', '-b', 'feature');
        assert.ok(call);
        assert.strictEqual(call.args[3], 'main');
    });

    it('switchBranch checks out an existing branch', async () => {
        const exec = makeMockExec((args) => {
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
                return 'switch-sha\n';
            }
            return '';
        });
        const service = createService(exec);

        const result = await service.switchBranch({ id: 'p1' }, 'main');
        assert.deepStrictEqual(result, { branch: 'main', sha: 'switch-sha' });
        assert.ok(findCall(exec.calls, 'checkout', 'main'));
    });

    it('deleteBranch deletes a branch', async () => {
        const exec = makeMockExec();
        const service = createService(exec);
        await service.deleteBranch({ id: 'p1' }, 'old-feature');
        assert.ok(findCall(exec.calls, 'branch', '-D', 'old-feature'));
    });

    it('listBranches parses local branches', async () => {
        const exec = makeMockExec(() => 'main|abc111|*\nfeature|def222|\n');
        const service = createService(exec);
        const branches = await service.listBranches({ id: 'p1' });
        assert.deepStrictEqual(branches, [
            { name: 'main', sha: 'abc111', current: true },
            { name: 'feature', sha: 'def222', current: false },
        ]);
    });

    it('getStatus reports working tree state and upstream divergence', async () => {
        const responses = new Map([
            [JSON.stringify(['rev-parse', '--abbrev-ref', 'HEAD']), 'dev\n'],
            [JSON.stringify(['rev-parse', 'HEAD']), 'status-sha\n'],
            [JSON.stringify(['status', '--porcelain=v1']), 'M  staged.txt\n?? untracked.txt\n'],
            [JSON.stringify(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']), '2\t3\n'],
        ]);
        const exec = makeMockExec((args) => responses.get(JSON.stringify(args)) ?? '');
        const service = createService(exec);

        const status = await service.getStatus({ id: 'p1' });
        assert.deepStrictEqual(status, {
            branch: 'dev',
            sha: 'status-sha',
            dirty: true,
            staged: true,
            unstaged: false,
            untracked: true,
            ahead: 2,
            behind: 3,
        });
    });

    it('commitAll stages and commits', async () => {
        const exec = makeMockExec((args) => {
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
                return 'commit-sha\n';
            }
            return '';
        });
        const service = createService(exec);
        const result = await service.commitAll({ id: 'p1' }, 'WIP');
        assert.deepStrictEqual(result, { sha: 'commit-sha' });
        assert.ok(findCall(exec.calls, 'add', '-A'));
        const commitCall = findCall(exec.calls, 'commit', '-m');
        assert.ok(commitCall);
        assert.strictEqual(commitCall.args[2], 'WIP');
    });

    it('pushBranch pushes and uses credentials', async () => {
        const exec = makeMockExec((args) => {
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
                return 'push-sha\n';
            }
            return '';
        });
        const service = createService(exec);
        const result = await service.pushBranch({ id: 'p1' }, 'feature', { force: true });
        assert.deepStrictEqual(result, { sha: 'push-sha' });
        const pushCall = findCall(exec.calls, 'push', 'origin', 'feature');
        assert.ok(pushCall);
        assert.strictEqual(pushCall.args[3], '--force');
        assert.ok(pushCall.env.GIT_ASKPASS);
    });

    it('getDiff returns diff output', async () => {
        const exec = makeMockExec(() => 'diff-output');
        const service = createService(exec);
        const diff = await service.getDiff({ id: 'p1' }, { base: 'HEAD~1' });
        assert.strictEqual(diff, 'diff-output');
        assert.deepStrictEqual(findCall(exec.calls, 'diff').args, ['diff', 'HEAD~1']);

        const diff2 = await service.getDiff({ id: 'p1' }, { base: 'main', head: 'feature' });
        assert.deepStrictEqual(findCall(exec.calls, 'diff', 'main', 'feature').args, [
            'diff',
            'main',
            'feature',
        ]);
    });

    it('getLog parses commits', async () => {
        const record1 = 'sha1\x1Ffirst\x1FAlice <alice@example.com>\x1F2024-01-01T00:00:00Z';
        const record2 = 'sha2\x1Fsecond\x1FBob <bob@example.com>\x1F2024-01-02T00:00:00Z';
        const exec = makeMockExec(() => `${record1}\x1E${record2}\x1E`);
        const service = createService(exec);
        const log = await service.getLog({ id: 'p1' }, { branch: 'main', limit: 5 });
        assert.strictEqual(log.length, 2);
        assert.deepStrictEqual(log[0], {
            sha: 'sha1',
            message: 'first',
            author: 'Alice <alice@example.com>',
            date: '2024-01-01T00:00:00Z',
        });
        const call = findCall(exec.calls, 'log', 'main');
        assert.ok(call);
        assert.strictEqual(call.args.includes('-n'), true);
        assert.strictEqual(call.args.includes('5'), true);
    });
});

describe('GitOperationService (real git)', { skip: !hasGit() }, () => {
    let tmpRoot;
    let origin;
    let workspacePath;
    let service;

    function git(args, cwd) {
        const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
        }
        return result;
    }

    before(async () => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'git-ops-'));
        origin = path.join(tmpRoot, 'origin.git');
        workspacePath = path.join(tmpRoot, 'workspace');
        fs.mkdirSync(workspacePath, { recursive: true });

        git(['init', '--bare', 'origin.git'], tmpRoot);

        const seed = path.join(tmpRoot, 'seed');
        fs.mkdirSync(seed, { recursive: true });
        git(['init'], seed);
        git(['config', 'user.email', 'seed@example.com'], seed);
        git(['config', 'user.name', 'Seed'], seed);
        fs.writeFileSync(path.join(seed, 'README.md'), 'hello');
        git(['add', '.'], seed);
        git(['commit', '-m', 'initial'], seed);
        git(['remote', 'add', 'origin', origin], seed);
        git(['push', 'origin', 'main'], seed);

        service = new GitOperationService({
            ensureProjectRuntime: async () => ({ workspacePath }),
            getToken: async () => undefined,
        });

        await service.cloneRepo({ id: 'p1' }, { repoUrl: origin, branch: 'main' });
        git(['config', 'user.email', 'test@example.com'], workspacePath);
        git(['config', 'user.name', 'Tester'], workspacePath);
    });

    after(() => {
        if (tmpRoot) {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it('clones a real repo into an existing workspace directory', async () => {
        const status = await service.getStatus({ id: 'p1' });
        assert.strictEqual(status.branch, 'main');
        assert.ok(status.sha);
        assert.strictEqual(status.dirty, false);
    });

    it('creates, switches and lists branches', async () => {
        await service.createBranch({ id: 'p1' }, 'feature', 'main');
        let branches = await service.listBranches({ id: 'p1' });
        let feature = branches.find((b) => b.name === 'feature');
        assert.ok(feature);
        assert.strictEqual(feature.current, true);

        await service.switchBranch({ id: 'p1' }, 'main');
        branches = await service.listBranches({ id: 'p1' });
        assert.strictEqual(branches.find((b) => b.name === 'main').current, true);
    });

    it('commits and pushes changes', async () => {
        await service.switchBranch({ id: 'p1' }, 'feature');
        fs.writeFileSync(path.join(workspacePath, 'feature.txt'), 'new work');

        let status = await service.getStatus({ id: 'p1' });
        assert.strictEqual(status.dirty, true);
        assert.strictEqual(status.untracked, true);

        const commit = await service.commitAll({ id: 'p1' }, 'add feature file');
        assert.ok(commit.sha);

        status = await service.getStatus({ id: 'p1' });
        assert.strictEqual(status.dirty, false);

        const push = await service.pushBranch({ id: 'p1' }, 'feature');
        assert.ok(push.sha);
    });

    it('returns log entries and diffs', async () => {
        const log = await service.getLog({ id: 'p1' }, { branch: 'feature', limit: 10 });
        assert.ok(log.length >= 2);
        assert.ok(log[0].sha);
        assert.ok(log[0].message);
        assert.ok(log[0].author);
        assert.ok(log[0].date);

        fs.writeFileSync(path.join(workspacePath, 'README.md'), 'changed');
        const diff = await service.getDiff({ id: 'p1' });
        assert.ok(diff.includes('README.md'));
    });
});
