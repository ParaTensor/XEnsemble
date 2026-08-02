const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { LocalGitService, parseBlameOutput, parseDetailedLog } = require('./LocalGitService');
const { assertRepoRelativePath, assertGitRef, assertGitBranch } = require('./gitValidation');

describe('Git input validation', () => {
    it('rejects workspace escapes and option-like refs', () => {
        assert.throws(() => assertRepoRelativePath('../../etc/passwd'), /inside the workspace/);
        assert.throws(() => assertRepoRelativePath('/etc/passwd'), /inside the workspace/);
        assert.throws(() => assertGitRef('--no-index'), /Invalid Git ref/);
        assert.throws(() => assertGitBranch('../main'), /Invalid Git ref/);
    });

    it('accepts repository paths and common branch refs', () => {
        assert.equal(assertRepoRelativePath('src/index.js'), 'src/index.js');
        assert.equal(assertGitRef('HEAD~1'), 'HEAD~1');
        assert.equal(assertGitBranch('feature/terminal-fix'), 'feature/terminal-fix');
    });
});

function hasGit() {
    return spawnSync('git', ['--version']).status === 0;
}

// ── Parser unit tests (no git needed) ──

describe('parseBlameOutput', () => {
    it('parses porcelain blame output correctly', () => {
        const output = [
            'abc123def456789012345678901234567890abcd 1 1 1',
            'author John Doe',
            'author-mail <john@example.com>',
            'author-time 1700000000',
            'author-tz +0000',
            'committer John Doe',
            'committer-mail <john@example.com>',
            'committer-time 1700000000',
            'committer-tz +0000',
            'summary Initial commit',
            'filename src/index.js',
            '\tconst x = 1;',
            'def456789012345678901234567890abcdef012345 2 2 1',
            'author Jane Smith',
            'author-mail <jane@example.com>',
            'author-time 1700100000',
            'author-tz +0000',
            'committer Jane Smith',
            'committer-mail <jane@example.com>',
            'committer-time 1700100000',
            'committer-tz +0000',
            'summary Add feature',
            'filename src/index.js',
            '\tconst y = 2;',
        ].join('\n');

        const entries = parseBlameOutput(output);
        assert.strictEqual(entries.length, 2);

        assert.strictEqual(entries[0].sha, 'abc123def456789012345678901234567890abcd');
        assert.strictEqual(entries[0].author, 'John Doe');
        assert.strictEqual(entries[0].date, 1700000000);
        assert.strictEqual(entries[0].lineNumber, 1);
        assert.strictEqual(entries[0].content, 'const x = 1;');

        assert.strictEqual(entries[1].sha, 'def456789012345678901234567890abcdef012345');
        assert.strictEqual(entries[1].author, 'Jane Smith');
        assert.strictEqual(entries[1].date, 1700100000);
        assert.strictEqual(entries[1].lineNumber, 2);
        assert.strictEqual(entries[1].content, 'const y = 2;');
    });

    it('returns empty array for empty output', () => {
        const entries = parseBlameOutput('');
        assert.deepStrictEqual(entries, []);
    });

    it('handles lines without author-time gracefully', () => {
        const output = [
            'abc123def456789012345678901234567890abcd 1 1 1',
            'author Unknown',
            'filename file.js',
            '\tsome code',
        ].join('\n');

        const entries = parseBlameOutput(output);
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].author, 'Unknown');
        assert.strictEqual(entries[0].date, null);
    });
});

describe('parseDetailedLog', () => {
    it('parses detailed log format with file changes', () => {
        const output = [
            'COMMIT_START',
            'abc123def456',
            'John Doe',
            'john@example.com',
            '1700000000',
            'Initial commit',
            'First line of body',
            'Second line of body',
            'COMMIT_BODY_END',
            'A\tsrc/index.js',
            'M\tsrc/utils.js',
            '',
            'COMMIT_START',
            'def456789012',
            'Jane Smith',
            'jane@example.com',
            '1700100000',
            'Add feature',
            '',
            'COMMIT_BODY_END',
            'M\tsrc/index.js',
            'D\tsrc/old.js',
            '',
        ].join('\n');

        const commits = parseDetailedLog(output);
        assert.strictEqual(commits.length, 2);

        assert.strictEqual(commits[0].sha, 'abc123def456');
        assert.strictEqual(commits[0].author, 'John Doe');
        assert.strictEqual(commits[0].email, 'john@example.com');
        assert.strictEqual(commits[0].timestamp, 1700000000);
        assert.strictEqual(commits[0].message, 'Initial commit');
        assert.strictEqual(commits[0].body, 'First line of body\nSecond line of body');
        assert.deepStrictEqual(commits[0].files, [
            { status: 'A', path: 'src/index.js' },
            { status: 'M', path: 'src/utils.js' },
        ]);

        assert.strictEqual(commits[1].sha, 'def456789012');
        assert.strictEqual(commits[1].author, 'Jane Smith');
        assert.strictEqual(commits[1].message, 'Add feature');
        assert.strictEqual(commits[1].body, null);
        assert.deepStrictEqual(commits[1].files, [
            { status: 'M', path: 'src/index.js' },
            { status: 'D', path: 'src/old.js' },
        ]);
    });

    it('returns empty array for empty output', () => {
        const commits = parseDetailedLog('');
        assert.deepStrictEqual(commits, []);
    });
});

// ── LocalGitService method tests (mock exec) ──

describe('LocalGitService Phase 4 methods (mocked)', () => {
    function makeMockExec(handler) {
        const calls = [];
        const fn = async (cmd, args, env, options) => {
            calls.push({ cmd, args, env, options });
            const out = typeof handler === 'function' ? handler(cmd, args) : '';
            if (out instanceof Error) throw out;
            return { exitCode: 0, stdout: out ?? '', stderr: '' };
        };
        fn.calls = calls;
        return fn;
    }

    function makeService(handler) {
        const exec = makeMockExec(handler);
        return {
            service: new LocalGitService({
                exec,
                ensureProjectRuntime: async () => ({ workspacePath: '/mock/workspace' }),
            }),
            exec,
        };
    }

    const project = { id: 'proj_test', userId: 'u1' };

    describe('blame', () => {
        it('calls git blame --porcelain with correct args', async () => {
            const blameOutput = [
                'abc123def456789012345678901234567890abcd 1 1 1',
                'author Dev',
                'author-time 1700000000',
                'filename src/app.js',
                '\tconsole.log("hello");',
            ].join('\n');

            const { service, exec } = makeService((cmd, args) => {
                if (args.includes('blame')) return blameOutput;
                return '';
            });

            const entries = await service.blame(project, 'src/app.js');
            assert.strictEqual(entries.length, 1);
            assert.strictEqual(entries[0].author, 'Dev');
            assert.strictEqual(entries[0].content, 'console.log("hello");');

            const call = exec.calls.find((c) => c.args.includes('blame'));
            assert.ok(call);
            assert.ok(call.args.includes('--porcelain'));
            assert.ok(call.args.includes('src/app.js'));
        });

        it('supports line range option', async () => {
            const { service, exec } = makeService(() => '');
            await service.blame(project, 'file.js', { startLine: 10, endLine: 20 });

            const call = exec.calls.find((c) => c.args.includes('blame'));
            assert.ok(call.args.includes('-L'));
            assert.ok(call.args.includes('10,20'));
        });

        it('supports ref option', async () => {
            const { service, exec } = makeService(() => '');
            await service.blame(project, 'file.js', { ref: 'abc123' });

            const call = exec.calls.find((c) => c.args.includes('blame'));
            assert.ok(call.args.includes('abc123'));
        });

        it('rejects path traversal', async () => {
            const { service } = makeService(() => '');
            await assert.rejects(
                () => service.blame(project, '../../../etc/passwd'),
                (err) => err.statusCode === 400,
            );
        });

        it('rejects absolute paths', async () => {
            const { service } = makeService(() => '');
            await assert.rejects(
                () => service.blame(project, '/etc/passwd'),
                (err) => err.statusCode === 400,
            );
        });

        it('throws 404 for non-existent file', async () => {
            const { service } = makeService((cmd, args) => {
                if (args.includes('blame')) {
                    const err = new Error('fatal: no such path');
                    throw err;
                }
                return '';
            });
            await assert.rejects(
                () => service.blame(project, 'nonexistent.js'),
                (err) => err.statusCode === 404,
            );
        });
    });

    describe('logDetailed', () => {
        it('calls git log with correct format and parses output', async () => {
            const logOutput = [
                'COMMIT_START',
                'sha123',
                'Author Name',
                'author@test.com',
                '1700000000',
                'feat: something',
                '',
                'COMMIT_BODY_END',
                'A\tnew-file.js',
                '',
            ].join('\n');

            const { service } = makeService((cmd, args) => {
                if (args.includes('log')) return logOutput;
                return '';
            });

            const commits = await service.logDetailed(project, { count: 10 });
            assert.strictEqual(commits.length, 1);
            assert.strictEqual(commits[0].sha, 'sha123');
            assert.strictEqual(commits[0].author, 'Author Name');
            assert.strictEqual(commits[0].email, 'author@test.com');
            assert.deepStrictEqual(commits[0].files, [{ status: 'A', path: 'new-file.js' }]);
        });

        it('limits count to 100', async () => {
            const { service, exec } = makeService(() => '');
            await service.logDetailed(project, { count: 500 });

            const call = exec.calls.find((c) => c.args.includes('log'));
            assert.ok(call.args.includes('-n'));
            assert.ok(call.args.includes('100'));
        });

        it('supports path filter', async () => {
            const { service, exec } = makeService(() => '');
            await service.logDetailed(project, { path: 'src/index.js' });

            const call = exec.calls.find((c) => c.args.includes('log'));
            assert.ok(call.args.includes('--'));
            assert.ok(call.args.includes('src/index.js'));
        });
    });

    describe('conflictCheck', () => {
        it('returns canMerge=true when merge-tree succeeds', async () => {
            const { service } = makeService((cmd, args) => {
                if (args.includes('rev-list')) return '3\t1';
                return '';
            });

            const result = await service.conflictCheck(project, 'main');
            assert.strictEqual(result.canMerge, true);
            assert.deepStrictEqual(result.conflictFiles, []);
            assert.strictEqual(result.aheadBehind.ahead, 3);
            assert.strictEqual(result.aheadBehind.behind, 1);
        });

        it('returns canMerge=false with conflict files on merge-tree failure', async () => {
            const { service } = makeService((cmd, args) => {
                if (args.includes('rev-list')) return '2\t5';
                if (args.includes('merge-tree')) {
                    throw new Error('CONFLICT (content): src/index.js');
                }
                return '';
            });

            const result = await service.conflictCheck(project, 'main');
            assert.strictEqual(result.canMerge, false);
            assert.ok(result.conflictFiles.includes('src/index.js'));
        });

        it('returns canMerge=null when fetch fails', async () => {
            const { service } = makeService((cmd, args) => {
                if (args.includes('rev-list')) return '0\t0';
                if (args.includes('fetch')) {
                    throw new Error('fatal: remote not found');
                }
                return '';
            });

            const result = await service.conflictCheck(project, 'nonexistent');
            assert.strictEqual(result.canMerge, null);
        });
    });

    describe('listConflicts', () => {
        it('returns list of conflicted files', async () => {
            const { service } = makeService((cmd, args) => {
                if (args.includes('--diff-filter=U')) {
                    return 'src/index.js\npackage.json\n';
                }
                return '';
            });

            const conflicts = await service.listConflicts(project);
            assert.strictEqual(conflicts.length, 2);
            assert.strictEqual(conflicts[0].path, 'src/index.js');
            assert.strictEqual(conflicts[0].status, 'conflicted');
            assert.strictEqual(conflicts[1].path, 'package.json');
        });

        it('returns empty array when no conflicts', async () => {
            const { service } = makeService(() => '');
            const conflicts = await service.listConflicts(project);
            assert.deepStrictEqual(conflicts, []);
        });
    });

    describe('resolveConflict', () => {
        it('resolves with ours strategy', async () => {
            const { service, exec } = makeService(() => '');
            const result = await service.resolveConflict(project, 'src/app.js', 'ours');

            assert.strictEqual(result.resolved, true);
            assert.strictEqual(result.strategy, 'ours');
            const checkoutCall = exec.calls.find((c) => c.args.includes('--ours'));
            assert.ok(checkoutCall);
            const addCall = exec.calls.find((c) => c.args[0] === 'add');
            assert.ok(addCall);
        });

        it('resolves with theirs strategy', async () => {
            const { service, exec } = makeService(() => '');
            const result = await service.resolveConflict(project, 'src/app.js', 'theirs');

            assert.strictEqual(result.resolved, true);
            assert.strictEqual(result.strategy, 'theirs');
            const checkoutCall = exec.calls.find((c) => c.args.includes('--theirs'));
            assert.ok(checkoutCall);
        });

        it('resolves with manual strategy (just git add)', async () => {
            const { service, exec } = makeService(() => '');
            const result = await service.resolveConflict(project, 'src/app.js', 'manual');

            assert.strictEqual(result.resolved, true);
            assert.strictEqual(result.strategy, 'manual');
            assert.ok(!exec.calls.find((c) => c.args.includes('--ours')));
            assert.ok(!exec.calls.find((c) => c.args.includes('--theirs')));
            assert.ok(exec.calls.find((c) => c.args[0] === 'add'));
        });

        it('rejects path traversal', async () => {
            const { service } = makeService(() => '');
            await assert.rejects(
                () => service.resolveConflict(project, '../../etc/shadow', 'ours'),
                (err) => err.statusCode === 400,
            );
        });
    });

    describe('showFile', () => {
        it('shows file at HEAD', async () => {
            const { service } = makeService((cmd, args) => {
                if (args[0] === 'show' && args[1] === 'HEAD:src/index.js') {
                    return 'const x = 1;\n';
                }
                return '';
            });

            const result = await service.showFile(project, 'src/index.js');
            assert.strictEqual(result.content, 'const x = 1;\n');
            assert.strictEqual(result.ref, 'HEAD');
            assert.strictEqual(result.path, 'src/index.js');
        });

        it('shows file at a specific ref', async () => {
            const { service } = makeService((cmd, args) => {
                if (args[0] === 'show' && args[1] === 'abc123:file.js') {
                    return 'old content';
                }
                return '';
            });

            const result = await service.showFile(project, 'file.js', 'abc123');
            assert.strictEqual(result.ref, 'abc123');
            assert.strictEqual(result.content, 'old content');
        });

        it('throws 404 for non-existent file', async () => {
            const { service } = makeService((cmd, args) => {
                if (args[0] === 'show') {
                    throw new Error('fatal: path not found');
                }
                return '';
            });

            await assert.rejects(
                () => service.showFile(project, 'missing.js'),
                (err) => err.statusCode === 404,
            );
        });

        it('rejects path traversal', async () => {
            const { service } = makeService(() => '');
            await assert.rejects(
                () => service.showFile(project, '../../../etc/passwd'),
                (err) => err.statusCode === 400,
            );
        });
    });
});

// ── Integration tests (requires real git) ──

describe('LocalGitService Phase 4 (real git)', { skip: !hasGit() }, () => {
    let tmpDir, wsDir, bareDir, service;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgs-p4-'));
        bareDir = path.join(tmpDir, 'test.git');
        wsDir = path.join(tmpDir, 'workspace');

        // Create bare repo
        spawnSync('git', ['init', '--bare', bareDir]);

        // Create workspace and commit files
        fs.mkdirSync(wsDir, { recursive: true });
        spawnSync('git', ['init', '-b', 'main'], { cwd: wsDir });
        spawnSync('git', ['remote', 'add', 'origin', bareDir], { cwd: wsDir });
        spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: wsDir });
        spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: wsDir });

        // First commit
        fs.writeFileSync(path.join(wsDir, 'file1.js'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
        spawnSync('git', ['add', '.'], { cwd: wsDir });
        spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: wsDir, env: { ...process.env, GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z' } });

        // Second commit with different author
        fs.writeFileSync(path.join(wsDir, 'file2.js'), 'export default {};\n');
        fs.writeFileSync(path.join(wsDir, 'file1.js'), 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n');
        spawnSync('git', ['add', '.'], { cwd: wsDir });
        spawnSync('git', ['commit', '-m', 'Add file2 and extend file1'], { cwd: wsDir, env: { ...process.env, GIT_COMMITTER_DATE: '2024-01-02T00:00:00Z', GIT_AUTHOR_DATE: '2024-01-02T00:00:00Z' } });

        // Push to bare
        spawnSync('git', ['push', 'origin', 'main'], { cwd: wsDir });

        service = new LocalGitService({
            exec: async (cmd, args, env, options) => {
                const result = spawnSync(cmd, args, {
                    cwd: options?.cwd || wsDir,
                    env: { ...process.env, ...env },
                    encoding: 'utf8',
                    timeout: 30000,
                });
                if (result.status !== 0) {
                    throw new Error(result.stderr || `git exited with ${result.status}`);
                }
                return { exitCode: 0, stdout: result.stdout || '', stderr: result.stderr || '' };
            },
            ensureProjectRuntime: async () => ({ workspacePath: wsDir }),
        });
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('blame returns line-by-line annotations for a real file', async () => {
        const entries = await service.blame({ id: 'p1', userId: 'u1' }, 'file1.js');
        assert.ok(entries.length >= 3);
        assert.ok(entries[0].sha);
        assert.ok(entries[0].author);
        assert.ok(entries[0].content);
    });

    it('blame with line range returns subset', async () => {
        const entries = await service.blame({ id: 'p1', userId: 'u1' }, 'file1.js', {
            startLine: 1, endLine: 2,
        });
        assert.strictEqual(entries.length, 2);
    });

    it('logDetailed returns commits with file lists', async () => {
        const commits = await service.logDetailed({ id: 'p1', userId: 'u1' });
        assert.ok(commits.length >= 2);

        const latest = commits[0];
        assert.ok(latest.sha);
        assert.strictEqual(latest.author, 'Test User');
        assert.strictEqual(latest.email, 'test@test.com');
        assert.ok(latest.files.length > 0);
        assert.ok(['A', 'M', 'D'].includes(latest.files[0].status));
    });

    it('logDetailed with path filter only shows commits touching that file', async () => {
        const commits = await service.logDetailed({ id: 'p1', userId: 'u1' }, {
            path: 'file2.js',
        });
        assert.strictEqual(commits.length, 1);
        assert.ok(commits[0].message.includes('file2'));
    });

    it('showFile returns file content at HEAD', async () => {
        const result = await service.showFile({ id: 'p1', userId: 'u1' }, 'file1.js');
        assert.ok(result.content.includes('const a = 1;'));
        assert.ok(result.content.includes('const d = 4;'));
    });

    it('showFile returns older version at a commit ref', async () => {
        const log = spawnSync('git', ['log', '--format=%H', '-n', '2'], { cwd: wsDir, encoding: 'utf8' });
        const shas = log.stdout.trim().split('\n');
        const olderSha = shas[1]; // second commit = Initial commit

        const result = await service.showFile({ id: 'p1', userId: 'u1' }, 'file1.js', olderSha);
        assert.ok(result.content.includes('const a = 1;'));
        assert.ok(!result.content.includes('const d = 4;'));
    });

    it('showFile throws 404 for missing file', async () => {
        await assert.rejects(
            () => service.showFile({ id: 'p1', userId: 'u1' }, 'nonexist.js'),
            (err) => err.statusCode === 404,
        );
    });

    it('listConflicts returns empty when no conflicts exist', async () => {
        const conflicts = await service.listConflicts({ id: 'p1', userId: 'u1' });
        assert.deepStrictEqual(conflicts, []);
    });
});

// ── GitHubAdapter review methods (mocked) ──

describe('GitHubAdapter listReviews', () => {
    it('normalizes GitHub review response', async () => {
        const { GitHubAdapter } = require('./providers/GitHubAdapter');
        const adapter = new GitHubAdapter();

        // Mock global fetch
        const originalFetch = global.fetch;
        global.fetch = async (url) => ({
            ok: true,
            json: async () => [
                {
                    id: 1001,
                    user: { login: 'reviewer1', avatar_url: 'https://example.com/avatar.png' },
                    state: 'APPROVED',
                    body: 'LGTM',
                    submitted_at: '2024-01-15T10:00:00Z',
                    html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-1001',
                },
                {
                    id: 1002,
                    user: { login: 'reviewer2', avatar_url: 'https://example.com/avatar2.png' },
                    state: 'CHANGES_REQUESTED',
                    body: 'Please fix the tests',
                    submitted_at: '2024-01-16T10:00:00Z',
                    html_url: 'https://github.com/owner/repo/pull/1#pullrequestreview-1002',
                },
            ],
        });

        try {
            const reviews = await adapter.listReviews('test-token', 'owner/repo', 1, {});
            assert.strictEqual(reviews.length, 2);
            assert.strictEqual(reviews[0].id, 1001);
            assert.strictEqual(reviews[0].user.login, 'reviewer1');
            assert.strictEqual(reviews[0].state, 'APPROVED');
            assert.strictEqual(reviews[0].body, 'LGTM');
            assert.strictEqual(reviews[1].state, 'CHANGES_REQUESTED');
        } finally {
            global.fetch = originalFetch;
        }
    });
});

describe('GitHubAdapter listReviewComments', () => {
    it('normalizes GitHub review comments response', async () => {
        const { GitHubAdapter } = require('./providers/GitHubAdapter');
        const adapter = new GitHubAdapter();

        const originalFetch = global.fetch;
        global.fetch = async (url) => ({
            ok: true,
            json: async () => [
                {
                    id: 2001,
                    path: 'src/index.js',
                    line: 42,
                    side: 'RIGHT',
                    user: { login: 'commenter', avatar_url: 'https://example.com/a.png' },
                    body: 'This could be simplified',
                    created_at: '2024-01-15T12:00:00Z',
                    updated_at: '2024-01-15T12:00:00Z',
                    in_reply_to_id: null,
                    diff_hunk: '@@ -40,3 +40,5 @@\n code here',
                },
            ],
        });

        try {
            const comments = await adapter.listReviewComments('test-token', 'owner/repo', 1, {});
            assert.strictEqual(comments.length, 1);
            assert.strictEqual(comments[0].id, 2001);
            assert.strictEqual(comments[0].path, 'src/index.js');
            assert.strictEqual(comments[0].line, 42);
            assert.strictEqual(comments[0].side, 'RIGHT');
            assert.strictEqual(comments[0].body, 'This could be simplified');
            assert.ok(comments[0].diffHunk.includes('code here'));
        } finally {
            global.fetch = originalFetch;
        }
    });
});

describe('GitLabAdapter listReviewComments', () => {
    it('normalizes GitLab MR notes response', async () => {
        const { GitLabAdapter } = require('./providers/GitLabAdapter');
        const adapter = new GitLabAdapter();

        const originalFetch = global.fetch;
        global.fetch = async (url) => ({
            ok: true,
            json: async () => [
                {
                    id: 3001,
                    system: false,
                    author: { username: 'gluser', avatar_url: 'https://gitlab.com/a.png' },
                    body: 'Needs refactoring',
                    position: { new_path: 'lib/main.rb', new_line: 10 },
                    created_at: '2024-01-15T12:00:00Z',
                    updated_at: '2024-01-15T12:00:00Z',
                },
                {
                    id: 3002,
                    system: true,
                    author: { username: 'gitlab-bot' },
                    body: 'mentioned in commit abc123',
                    position: null,
                    created_at: '2024-01-15T12:00:00Z',
                    updated_at: '2024-01-15T12:00:00Z',
                },
            ],
        });

        try {
            const comments = await adapter.listReviewComments('test-token', 'group/repo', 5, { apiBase: 'https://gitlab.com/api/v4' });
            // System notes should be filtered out
            assert.strictEqual(comments.length, 1);
            assert.strictEqual(comments[0].id, 3001);
            assert.strictEqual(comments[0].path, 'lib/main.rb');
            assert.strictEqual(comments[0].line, 10);
            assert.strictEqual(comments[0].user.login, 'gluser');
            assert.strictEqual(comments[0].body, 'Needs refactoring');
        } finally {
            global.fetch = originalFetch;
        }
    });
});

describe('GitProviderService base class defaults', () => {
    it('listReviews returns empty array by default', async () => {
        const { GitProviderService } = require('./providers/GitProviderService');
        const base = new GitProviderService();
        const reviews = await base.listReviews('token', 'owner/repo', 1, {});
        assert.deepStrictEqual(reviews, []);
    });

    it('listReviewComments returns empty array by default', async () => {
        const { GitProviderService } = require('./providers/GitProviderService');
        const base = new GitProviderService();
        const comments = await base.listReviewComments('token', 'owner/repo', 1, {});
        assert.deepStrictEqual(comments, []);
    });
});
