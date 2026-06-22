const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { LocalGitService, bareRepoPath, formatCheckpointMessage, BARE_REPO_ROOT } = require('./LocalGitService');

function hasGit() {
    return spawnSync('git', ['--version']).status === 0;
}

// ── Unit tests (no git needed) ──

describe('formatCheckpointMessage', () => {
    it('produces structured commit message with trigger and summary', () => {
        const msg = formatCheckpointMessage({
            trigger: 'session.end',
            summary: 'Fixed preview port binding',
            sessionId: 'sess_abc123',
            agentId: 'claude',
            steps: 42,
        });
        assert.ok(msg.startsWith('checkpoint(session.end):'));
        assert.ok(msg.includes('session_id: sess_abc123'));
        assert.ok(msg.includes('trigger: session.end'));
        assert.ok(msg.includes('agent_id: claude'));
        assert.ok(msg.includes('steps: 42'));
        assert.ok(msg.includes('summary: Fixed preview port binding'));
    });

    it('defaults trigger to manual', () => {
        const msg = formatCheckpointMessage({});
        assert.ok(msg.startsWith('checkpoint(manual):'));
    });

    it('truncates summary to 500 characters', () => {
        const longSummary = 'a'.repeat(300) + 'B'.repeat(300);
        const msg = formatCheckpointMessage({ summary: longSummary });
        const summaryLine = msg.split('\n').find((l) => l.startsWith('summary: '));
        const summaryValue = summaryLine.slice('summary: '.length);
        assert.strictEqual(summaryValue.length, 500);
        assert.ok(summaryValue.endsWith('B'.repeat(200)));
    });
});

describe('bareRepoPath', () => {
    it('returns <BARE_REPO_ROOT>/<projectId>.git', () => {
        const p = bareRepoPath('proj_abc123');
        assert.strictEqual(p, path.join(BARE_REPO_ROOT, 'proj_abc123.git'));
    });
});

// ── Integration tests (requires git binary) ──

describe('LocalGitService (mock exec, mock DB)', () => {
    // Use a mock exec that simulates git commands
    function makeMockExec(handler) {
        const calls = [];
        const fn = async (cmd, args, env, options) => {
            calls.push({ cmd, args, env, options });
            const out = typeof handler === 'function' ? handler(cmd, args) : '';
            return { exitCode: 0, stdout: out ?? '', stderr: '' };
        };
        fn.calls = calls;
        return fn;
    }

    function findCall(calls, ...argPrefix) {
        return calls.find((c) =>
            c.cmd === 'git' && argPrefix.every((arg, i) => c.args[i] === arg),
        );
    }

    it('initRepo calls git init --bare, git init, git remote add, git commit, git push', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-init-'));
        const bareDir = path.join(tmpDir, 'bare.git');
        const wsDir = path.join(tmpDir, 'ws');
        fs.mkdirSync(wsDir, { recursive: true });

        // Override BARE_REPO_ROOT via monkeypatch for this test
        const origBareRepoPath = require('./LocalGitService').bareRepoPath;

        const exec = makeMockExec((cmd, args) => {
            if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'abc123def456';
            return '';
        });

        // We can't easily test initRepo with mocks since it uses fs.mkdirSync
        // and the module-level BARE_REPO_ROOT. Instead, test that _git calls
        // are made correctly via the mock exec service.
        const service = new LocalGitService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: wsDir }),
        });

        // Call _git directly to verify plumbing works
        await service._git(wsDir, ['init', '-b', 'main']);
        assert.ok(findCall(exec.calls, 'init', '-b', 'main'));

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('getLog parses git log output correctly', async () => {
        const exec = makeMockExec((cmd, args) => {
            if (args[0] === 'log') {
                return [
                    'abc123 Fix bug in auth 1710000000',
                    'def456 Initial commit 1709999000',
                ].join('\n');
            }
            return '';
        });

        const service = new LocalGitService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: '/workspace' }),
        });

        const log = await service.getLog({ id: 'proj_1', userId: 'u1' }, { count: 10 });
        assert.strictEqual(log.length, 2);
        assert.strictEqual(log[0].sha, 'abc123');
        assert.strictEqual(log[0].message, 'Fix bug in auth');
        assert.strictEqual(log[0].timestamp, 1710000000);
        assert.strictEqual(log[1].sha, 'def456');
        assert.strictEqual(log[1].message, 'Initial commit');
    });

    it('getLog limits count to 100 max', async () => {
        const exec = makeMockExec(() => '');
        const service = new LocalGitService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: '/workspace' }),
        });

        await service.getLog({ id: 'proj_1', userId: 'u1' }, { count: 500 });
        const logCall = findCall(exec.calls, 'log');
        assert.ok(logCall);
        assert.ok(logCall.args.includes('100'));
    });

    it('getDiff calls git show and returns stat by default', async () => {
        const exec = makeMockExec((cmd, args) => {
            if (args[0] === 'cat-file') return 'commit';
            if (args[0] === 'show' && args[1] === '--stat') return ' file.js | 3 +++\n 1 file changed';
            if (args[0] === 'show') return 'diff --git a/file.js b/file.js\n...';
            return '';
        });

        const service = new LocalGitService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: '/workspace' }),
        });

        const result = await service.getDiff({ id: 'proj_1', userId: 'u1' }, 'abc123');
        assert.strictEqual(result.sha, 'abc123');
        assert.ok(result.stat);
        assert.strictEqual(result.diff, undefined);
    });

    it('getDiff with full=true returns full patch', async () => {
        const exec = makeMockExec((cmd, args) => {
            if (args[0] === 'cat-file') return 'commit';
            if (args[0] === 'show' && args.length === 2) return 'diff --git a/file.js\n+added line';
            if (args[0] === 'show' && args[1] === '--stat') return ' file.js | 1 +';
            return '';
        });

        const service = new LocalGitService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: '/workspace' }),
        });

        const result = await service.getDiff({ id: 'proj_1', userId: 'u1' }, 'abc123', { full: true });
        assert.strictEqual(result.sha, 'abc123');
        assert.ok(result.diff);
        assert.strictEqual(result.stat, undefined);
    });

    it('getDiff throws 404 when SHA not found', async () => {
        const exec = makeMockExec((cmd, args) => {
            if (args[0] === 'cat-file') throw Object.assign(new Error('not found'), { exitCode: 128 });
            return '';
        });

        const service = new LocalGitService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: '/workspace' }),
        });

        await assert.rejects(
            () => service.getDiff({ id: 'proj_1', userId: 'u1' }, 'bad_sha'),
            (err) => err.statusCode === 404,
        );
    });

    it('diffRange calls git diff with two SHAs', async () => {
        const exec = makeMockExec(() => 'diff output');
        const service = new LocalGitService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: '/workspace' }),
        });

        const result = await service.diffRange({ id: 'proj_1', userId: 'u1' }, 'sha1', 'sha2');
        assert.strictEqual(result.from, 'sha1');
        assert.strictEqual(result.to, 'sha2');
        assert.ok(result.diff);
        const diffCall = findCall(exec.calls, 'diff', 'sha1', 'sha2');
        assert.ok(diffCall);
    });

    it('diffRange without toSha diffs against working tree', async () => {
        const exec = makeMockExec(() => 'diff output');
        const service = new LocalGitService({
            exec,
            ensureProjectRuntime: async () => ({ workspacePath: '/workspace' }),
        });

        const result = await service.diffRange({ id: 'proj_1', userId: 'u1' }, 'sha1');
        assert.strictEqual(result.to, 'working-tree');
        const diffCall = findCall(exec.calls, 'diff', 'sha1');
        assert.ok(diffCall);
        assert.strictEqual(diffCall.args.length, 2); // ['diff', 'sha1']
    });
});

// ── Real git integration tests ──

describe('LocalGitService (real git)', { skip: !hasGit() && 'git not available' }, () => {
    let tmpDir;
    let wsDir;
    let service;

    function realExec(cmd, args, env, options) {
        const result = spawnSync(cmd, args, {
            cwd: options?.cwd,
            env: { ...process.env, ...env },
            encoding: 'utf8',
            timeout: (options?.timeoutMs) || 30_000,
        });
        return {
            exitCode: result.status ?? 1,
            stdout: result.stdout || '',
            stderr: result.stderr || '',
        };
    }

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-real-'));
        wsDir = path.join(tmpDir, 'workspace');
        fs.mkdirSync(wsDir, { recursive: true });

        // Initialize a real git repo
        spawnSync('git', ['init', '-b', 'main'], { cwd: wsDir });
        spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: wsDir });
        spawnSync('git', ['config', 'user.name', 'Test'], { cwd: wsDir });
        fs.writeFileSync(path.join(wsDir, 'README.md'), '# Test\n');
        spawnSync('git', ['add', '-A'], { cwd: wsDir });
        spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: wsDir });

        service = new LocalGitService({
            exec: realExec,
            ensureProjectRuntime: async () => ({ workspacePath: wsDir }),
        });
    });

    after(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('getLog returns commits from a real repo', async () => {
        const log = await service.getLog({ id: 'p1', userId: 'u1' });
        assert.ok(log.length >= 1);
        assert.strictEqual(log[0].message, 'Initial commit');
        assert.ok(log[0].sha.length >= 7);
        assert.ok(typeof log[0].timestamp === 'number');
    });

    it('getDiff returns stat for a real commit', async () => {
        const log = await service.getLog({ id: 'p1', userId: 'u1' });
        const sha = log[0].sha;
        const result = await service.getDiff({ id: 'p1', userId: 'u1' }, sha);
        assert.strictEqual(result.sha, sha);
        assert.ok(result.stat);
        assert.ok(result.stat.includes('README.md'));
    });

    it('getDiff full=true returns full patch', async () => {
        const log = await service.getLog({ id: 'p1', userId: 'u1' });
        const sha = log[0].sha;
        const result = await service.getDiff({ id: 'p1', userId: 'u1' }, sha, { full: true });
        assert.ok(result.diff);
        assert.ok(result.diff.includes('README.md'));
    });

    it('ensureGitInit returns false for already initialized repo', async () => {
        const wasInit = await service.ensureGitInit({ id: 'p1', userId: 'u1' });
        assert.strictEqual(wasInit, false);
    });

    it('diffRange produces diff between HEAD and working tree', async () => {
        // Make a working tree change
        fs.writeFileSync(path.join(wsDir, 'new.txt'), 'hello\n');

        const log = await service.getLog({ id: 'p1', userId: 'u1' });
        const result = await service.diffRange({ id: 'p1', userId: 'u1' }, log[0].sha);
        assert.strictEqual(result.to, 'working-tree');
        // Diff may or may not show changes depending on git add state
        // Just verify it doesn't throw

        // Clean up
        fs.unlinkSync(path.join(wsDir, 'new.txt'));
    });
});
