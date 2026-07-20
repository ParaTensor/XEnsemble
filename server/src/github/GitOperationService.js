const { getRuntime } = require('../runtime/registry');
const { ensureProjectRuntime } = require('../runtime/RuntimeService');
const { stripCredentialFromUrl, buildCredentialEnv } = require('./gitCredentialHelper');

class GitError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'GitError';
        this.code = code;
    }
}

async function defaultGetToken(project) {
    const provider = project.repoProvider;
    if (!provider || provider === 'none' || provider === 'local_git') {
        return undefined;
    }
    const { GitConnectionService } = require('./GitConnectionService');
    return new GitConnectionService().getDecryptedToken(project.userId);
}

class GitOperationService {
    constructor(deps = {}) {
        this.exec = deps.exec ?? getRuntime().exec;
        this.ensureProjectRuntime = deps.ensureProjectRuntime ?? ensureProjectRuntime;
        this.getToken = deps.getToken ?? defaultGetToken;
    }

    _execFn() {
        if (typeof this.exec === 'function') {
            return this.exec;
        }
        if (typeof this.exec?.exec === 'function') {
            return this.exec.exec.bind(this.exec);
        }
        throw new GitError('No usable exec adapter provided to GitOperationService');
    }

    async _execGit(project, args, options = {}) {
        const ready = await this.ensureProjectRuntime(project);
        const workspacePath = ready.workspacePath;
        const runtimeRef = ready.runtime ? ready.runtime.runtimeRef : undefined;
        const token = await this._resolveToken(project);
        const credentials = token ? buildCredentialEnv(token) : null;

        try {
            const exec = this._execFn();
            const result = await exec(
                'git',
                args,
                credentials ? credentials.env : {},
                { cwd: workspacePath, runtimeRef, timeoutMs: 120_000, ...options },
            );

            if (result.exitCode !== 0) {
                throw new GitError(
                    `git ${args.join(' ')} failed (${result.exitCode}): ${result.stderr || result.stdout}`,
                    result.exitCode,
                );
            }

            return { ...result, workspacePath };
        } finally {
            if (credentials) {
                credentials.cleanup();
            }
        }
    }

    async _resolveToken(project) {
        if (!this.getToken) {
            return undefined;
        }
        return this.getToken(project);
    }

    async _revParse(project, ref) {
        const { stdout } = await this._execGit(project, ['rev-parse', ref]);
        return stdout.trim();
    }

    async cloneRepo(project, { repoUrl, branch, depth } = {}) {
        if (!repoUrl) {
            throw new GitError('repoUrl is required');
        }

        const cleanUrl = stripCredentialFromUrl(repoUrl);

        await this._execGit(project, ['init']);

        try {
            await this._execGit(project, ['remote', 'add', 'origin', cleanUrl]);
        } catch (err) {
            if (err.message.includes('remote origin already exists')) {
                await this._execGit(project, ['remote', 'set-url', 'origin', cleanUrl]);
            } else {
                throw err;
            }
        }

        const fetchArgs = ['fetch', 'origin'];
        if (branch) {
            fetchArgs.push(branch);
        }
        if (depth) {
            fetchArgs.push('--depth', String(depth));
        }
        await this._execGit(project, fetchArgs);

        let localBranch = branch;
        if (!localBranch) {
            const { stdout } = await this._execGit(project, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
            const remoteRef = stdout.trim();
            localBranch = remoteRef.replace(/^origin\//, '');
            await this._execGit(project, ['checkout', '-b', localBranch, remoteRef]);
        } else {
            await this._execGit(project, ['checkout', '-b', localBranch, `origin/${localBranch}`]);
        }

        const sha = await this._revParse(project, 'HEAD');
        return { sha, branch: localBranch };
    }

    async createBranch(project, branchName, baseBranch) {
        const args = ['checkout', '-b', branchName];
        if (baseBranch) {
            args.push(baseBranch);
        }
        await this._execGit(project, args);
        const sha = await this._revParse(project, 'HEAD');
        return { branch: branchName, sha };
    }

    async switchBranch(project, branchName) {
        try {
            await this._execGit(project, ['checkout', branchName]);
        } catch (err) {
            const remoteRef = `origin/${branchName}`;
            try {
                await this._execGit(project, ['rev-parse', '--verify', '--quiet', remoteRef]);
                await this._execGit(project, ['checkout', '-b', branchName, remoteRef]);
            } catch {
                throw err;
            }
        }

        const sha = await this._revParse(project, 'HEAD');
        return { branch: branchName, sha };
    }

    async deleteBranch(project, branchName) {
        await this._execGit(project, ['branch', '-D', branchName]);
    }

    async listBranches(project) {
        const { stdout } = await this._execGit(project, [
            'for-each-ref',
            'refs/heads/',
            '--format=%(refname:short)|%(objectname:short)|%(HEAD)',
        ]);

        return stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => {
                const [name, sha, head] = line.split('|');
                if (!name || !sha) {
                    return null;
                }
                return {
                    name,
                    sha,
                    current: head === '*',
                };
            })
            .filter(Boolean);
    }

    async getStatus(project) {
        const [branchOut, shaOut, statusOut] = await Promise.all([
            this._execGit(project, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => ({ stdout: 'HEAD' })),
            this._execGit(project, ['rev-parse', 'HEAD']).catch(() => ({ stdout: '' })),
            this._execGit(project, ['status', '--porcelain=v1']),
        ]);

        let branch = branchOut.stdout.trim();
        if (branch === 'HEAD') {
            branch = null;
        }
        const sha = shaOut.stdout.trim() || null;

        const lines = statusOut.stdout.split('\n').filter(Boolean);
        let dirty = false;
        let staged = false;
        let unstaged = false;
        let untracked = false;
        const files = [];

        for (const line of lines) {
            if (line.length < 2) {
                continue;
            }
            const x = line[0];
            const y = line[1];
            const filePath = line.slice(3).trim();
            const entry = { path: filePath, status: x + y };
            if (x === '?' && y === '?') {
                untracked = true;
                dirty = true;
                entry.type = 'untracked';
            } else {
                if (x !== ' ') {
                    staged = true;
                    dirty = true;
                }
                if (y !== ' ') {
                    unstaged = true;
                    dirty = true;
                }
                if (x !== ' ' && y !== ' ') {
                    entry.type = 'both';
                } else if (x !== ' ') {
                    entry.type = 'staged';
                } else {
                    entry.type = 'modified';
                }
            }
            files.push(entry);
        }

        let ahead = 0;
        let behind = 0;
        try {
            const ab = await this._execGit(project, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
            const [a, b] = ab.stdout.trim().split('\t').map((n) => Number(n) || 0);
            ahead = a;
            behind = b;
        } catch {
            // No upstream or no commits yet.
        }

        return { branch, sha, dirty, staged, unstaged, untracked, ahead, behind, files };
    }

    async commitAll(project, message) {
        await this._execGit(project, ['add', '-A']);
        await this._execGit(project, ['commit', '-m', message]);
        const sha = await this._revParse(project, 'HEAD');
        return { sha };
    }

    async pushBranch(project, branchName, { force = false } = {}) {
        const args = ['push', 'origin', branchName];
        if (force) {
            args.push('--force');
        }
        await this._execGit(project, args);
        const sha = await this._revParse(project, 'HEAD');
        return { sha };
    }

    async getDiff(project, { base, head } = {}) {
        const args = ['diff'];
        if (base && head) {
            args.push(base, head);
        } else if (base) {
            args.push(base);
        }
        const { stdout } = await this._execGit(project, args);
        return stdout;
    }

    async getFileDiff(project, filePath) {
        const { stdout } = await this._execGit(project, ['diff', '--', filePath]);
        return stdout;
    }

    async getFileContentAtRef(project, filePath, ref = 'HEAD') {
        const { stdout } = await this._execGit(project, ['show', `${ref}:${filePath}`]);
        return stdout;
    }

    async mergeBranch(project, fromBranch, toBranch) {
        await this.switchBranch(project, toBranch);
        await this._execGit(project, ['merge', fromBranch, '-m', `Merge ${fromBranch} into ${toBranch}`]);
        const sha = await this._revParse(project, 'HEAD');
        return { sha };
    }

    async getLog(project, { branch, limit = 20 } = {}) {
        const args = ['log'];
        if (branch) {
            args.push(branch);
        }
        args.push('--format=%H%x1F%s%x1F%an <%ae>%x1F%aI%x1E', '-n', String(limit));

        const { stdout } = await this._execGit(project, args);

        return stdout
            .split('\x1E')
            .filter(Boolean)
            .map((record) => {
                const [sha, message, author, date] = record.split('\x1F');
                return { sha, message, author, date };
            });
    }
}

module.exports = { GitOperationService, GitError };
