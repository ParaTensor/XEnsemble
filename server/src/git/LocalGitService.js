/**
 * LocalGitService — Layer 1 built-in Git management.
 *
 * Provides per-project Git version tracking without any external provider.
 * All git commands run through the Runtime exec adapter (Local/BoxLite/K8s).
 *
 * See docs/LocalGit.md for the full specification.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { eq, and } = require('drizzle-orm');
const { getRuntime } = require('../runtime/registry');
const { ensureProjectRuntime } = require('../runtime/RuntimeService');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { recordEvent } = require('../events/recordEvent');
const { singleflight } = require('../runtime/singleflight');

const BARE_REPO_ROOT = process.env.BARE_REPO_ROOT
    || path.join(__dirname, '../../data/repos');

const GITIGNORE_TEMPLATE = `# XEnsemble runtime / secrets — never version
.env
.env.*
!.env.example

# Dependencies & build
node_modules/
dist/
build/
.next/
.turbo/
__pycache__/
*.pyc
.venv/
venv/

# IDE / OS
.DS_Store
.idea/
.vscode/

# Logs & local caches
*.log
.npm/
.cache/
`;

function newId(prefix) {
    return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function bareRepoPath(projectId) {
    return path.join(BARE_REPO_ROOT, `${projectId}.git`);
}

function formatCheckpointMessage(meta = {}) {
    const trigger = meta.trigger || 'manual';
    const summary = meta.summary || '';
    const lines = [`checkpoint(${trigger}): ${summary || 'checkpoint'}`];
    lines.push('');
    if (meta.sessionId) lines.push(`session_id: ${meta.sessionId}`);
    lines.push(`trigger: ${trigger}`);
    if (meta.agentId) lines.push(`agent_id: ${meta.agentId}`);
    if (meta.steps != null) lines.push(`steps: ${meta.steps}`);
    if (summary) lines.push(`summary: ${summary.slice(0, 500)}`);
    return lines.join('\n');
}

class LocalGitService {
    constructor(deps = {}) {
        this.exec = deps.exec ?? getRuntime().exec;
        this.ensureProjectRuntime = deps.ensureProjectRuntime ?? ensureProjectRuntime;
    }

    _execFn() {
        if (typeof this.exec === 'function') return this.exec;
        if (typeof this.exec?.exec === 'function') return this.exec.exec.bind(this.exec);
        throw new Error('No usable exec adapter provided to LocalGitService');
    }

    async _git(cwd, args, options = {}) {
        const exec = this._execFn();
        const result = await exec('git', args, {}, {
            cwd,
            timeoutMs: options.timeoutMs || 30_000,
            ...options,
        });
        if (result.exitCode !== 0) {
            const err = new Error(`git ${args[0]} failed: ${result.stderr || result.stdout}`);
            err.exitCode = result.exitCode;
            throw err;
        }
        return result;
    }

    // ── Init ──

    /**
     * Initialize a bare repo + workspace git repo for a new project.
     * Called during project creation when repoProvider = 'local_git'.
     */
    async initRepo(project) {
        return singleflight(`local-git-init:${project.id}`, async () => {
            const bare = bareRepoPath(project.id);

            // Create bare repo directory
            fs.mkdirSync(bare, { recursive: true });
            await this._git(bare, ['init', '--bare', '-b', 'main']);

            // Set up working copy in workspace
            const { workspacePath } = await this.ensureProjectRuntime(project);
            await this._git(workspacePath, ['init', '-b', 'main']);
            await this._git(workspacePath, ['config', 'user.email', 'xensemble@local']);
            await this._git(workspacePath, ['config', 'user.name', 'XEnsemble']);
            await this._git(workspacePath, ['remote', 'add', 'origin', bare]);

            // Write .gitignore
            const ignorePath = path.join(workspacePath, '.gitignore');
            if (!fs.existsSync(ignorePath)) {
                fs.writeFileSync(ignorePath, GITIGNORE_TEMPLATE, 'utf8');
            }

            // Initial commit
            await this._git(workspacePath, ['add', '-A']);
            await this._git(workspacePath, [
                'commit', '--allow-empty', '-m', 'chore: initialize workspace',
            ]);

            // Push to bare repo
            await this._git(workspacePath, ['push', '-u', 'origin', 'main']);

            // Update project DB fields
            await db.update(schema.projects).set({
                repoProvider: 'local_git',
                workspaceMode: 'git',
                repoUrl: bare,
                repoDefaultBranch: 'main',
            }).where(eq(schema.projects.id, project.id));

            const headResult = await this._git(workspacePath, ['rev-parse', 'HEAD']);
            const sha = headResult.stdout.trim();

            await recordEvent({
                userId: project.userId,
                projectId: project.id,
                subjectType: 'project',
                subjectId: project.id,
                type: 'local_git.initialized',
                data: { bareRepoPath: bare, initialSha: sha },
            });

            return { bareRepoPath: bare, workspacePath, initialSha: sha };
        });
    }

    /**
     * Lazy init: if a project's workspace has no .git, initialize it.
     * Returns true if init was performed, false if already initialized.
     */
    async ensureGitInit(project) {
        const { workspacePath } = await this.ensureProjectRuntime(project);
        try {
            await this._git(workspacePath, ['rev-parse', '--git-dir']);
            return false; // already initialized
        } catch {
            await this.initRepo(project);
            return true;
        }
    }

    // ── Checkpoint ──

    /**
     * Create a checkpoint: git add -A + git commit + record in DB.
     * If no changes, still records the checkpoint pointing at HEAD.
     */
    async commitCheckpoint(project, meta = {}) {
        return singleflight(`local-git-ckpt:${project.id}`, async () => {
            const { workspacePath } = await this.ensureProjectRuntime(project);

            // Ensure git is initialized
            await this.ensureGitInit(project);

            await this._git(workspacePath, ['add', '-A']);

            // Check if there are staged changes
            let hasChanges = true;
            try {
                await this._git(workspacePath, ['diff', '--cached', '--quiet']);
                hasChanges = false;
            } catch {
                // diff --quiet exits with 1 if there are changes
            }

            let sha;
            if (hasChanges) {
                const message = formatCheckpointMessage(meta);
                await this._git(workspacePath, ['commit', '-m', message]);
            }

            const headResult = await this._git(workspacePath, ['rev-parse', 'HEAD']);
            sha = headResult.stdout.trim();

            // Push to bare repo (best-effort)
            try {
                await this._git(workspacePath, ['push', 'origin', 'HEAD']);
            } catch {
                // Push failure is non-fatal for checkpoint
            }

            // Record checkpoint in DB
            const checkpointId = newId('ckpt');
            const now = Date.now();
            const row = {
                id: checkpointId,
                projectId: project.id,
                sessionId: meta.sessionId || null,
                baseSnapshotId: project.lastSnapshotId || null,
                status: 'ready',
                storageRef: null,
                diffRef: null,
                gitSha: sha,
                createdBy: meta.userId || null,
                createdAt: now,
                expiresAt: null,
            };
            await db.insert(schema.workspaceCheckpoints).values(row);

            // Update project last_sync_sha
            await db.update(schema.projects).set({
                lastSyncSha: sha,
            }).where(eq(schema.projects.id, project.id));

            await recordEvent({
                userId: project.userId,
                projectId: project.id,
                subjectType: 'workspace_checkpoint',
                subjectId: checkpointId,
                type: 'workspace_checkpoint.ready',
                data: {
                    sessionId: meta.sessionId,
                    trigger: meta.trigger || 'manual',
                    gitSha: sha,
                    hasChanges,
                },
            });

            return {
                id: checkpointId,
                project_id: project.id,
                session_id: meta.sessionId || null,
                git_sha: sha,
                status: 'ready',
                has_changes: hasChanges,
                created_at: now,
            };
        });
    }

    // ── Restore ──

    /**
     * Restore workspace to a specific checkpoint's git SHA.
     */
    async restoreCheckpoint(project, checkpointId, options = {}) {
        const rows = await db.select().from(schema.workspaceCheckpoints)
            .where(and(
                eq(schema.workspaceCheckpoints.id, checkpointId),
                eq(schema.workspaceCheckpoints.projectId, project.id),
            ));

        if (rows.length === 0) {
            const err = new Error('Checkpoint not found');
            err.statusCode = 404;
            throw err;
        }

        const checkpoint = rows[0];
        if (!checkpoint.gitSha) {
            const err = new Error('Checkpoint has no git_sha');
            err.statusCode = 409;
            throw err;
        }

        const { workspacePath } = await this.ensureProjectRuntime(project);

        // Verify SHA exists in repo
        try {
            await this._git(workspacePath, ['cat-file', '-t', checkpoint.gitSha]);
        } catch {
            const err = new Error(`SHA ${checkpoint.gitSha} not found in repository`);
            err.statusCode = 409;
            throw err;
        }

        await this._git(workspacePath, ['reset', '--hard', checkpoint.gitSha], { timeoutMs: 60_000 });

        if (options.cleanUntracked !== false) {
            await this._git(workspacePath, ['clean', '-fd']);
        }

        await db.update(schema.projects).set({
            lastSyncSha: checkpoint.gitSha,
        }).where(eq(schema.projects.id, project.id));

        await recordEvent({
            userId: project.userId,
            projectId: project.id,
            subjectType: 'workspace_checkpoint',
            subjectId: checkpointId,
            type: 'workspace_checkpoint.restored',
            data: { gitSha: checkpoint.gitSha, cleanUntracked: options.cleanUntracked !== false },
        });

        return {
            id: checkpointId,
            project_id: project.id,
            git_sha: checkpoint.gitSha,
            restored: true,
        };
    }

    // ── Introspection ──

    /**
     * Get recent commit log.
     * @returns {Array<{ sha, message, timestamp }>}
     */
    async getLog(project, options = {}) {
        const { workspacePath } = await this.ensureProjectRuntime(project);
        const count = Math.min(options.count || 20, 100);
        const result = await this._git(workspacePath, [
            'log', `-n`, String(count), `--format=%H %s %ct`,
        ]);

        return result.stdout.trim().split('\n').filter(Boolean).map((line) => {
            const spaceIdx = line.indexOf(' ');
            const sha = line.slice(0, spaceIdx);
            const rest = line.slice(spaceIdx + 1);
            const lastSpace = rest.lastIndexOf(' ');
            const message = rest.slice(0, lastSpace);
            const timestamp = Number(rest.slice(lastSpace + 1));
            return { sha, message, timestamp };
        });
    }

    /**
     * Get diff for a specific commit (git show --stat).
     */
    async getDiff(project, sha, options = {}) {
        const { workspacePath } = await this.ensureProjectRuntime(project);

        // Verify SHA exists
        try {
            await this._git(workspacePath, ['cat-file', '-t', sha]);
        } catch {
            const err = new Error(`SHA ${sha} not found in repository`);
            err.statusCode = 404;
            throw err;
        }

        if (options.full) {
            const result = await this._git(workspacePath, ['show', sha], { timeoutMs: 60_000 });
            return { sha, diff: result.stdout };
        }

        const statResult = await this._git(workspacePath, ['show', '--stat', sha]);
        return { sha, stat: statResult.stdout };
    }

    /**
     * Get diff between two commits or between a commit and working tree.
     */
    async diffRange(project, fromSha, toSha) {
        const { workspacePath } = await this.ensureProjectRuntime(project);
        const args = toSha ? ['diff', fromSha, toSha] : ['diff', fromSha];
        const result = await this._git(workspacePath, args, { timeoutMs: 60_000 });
        return { from: fromSha, to: toSha || 'working-tree', diff: result.stdout };
    }
}

module.exports = { LocalGitService, bareRepoPath, formatCheckpointMessage, BARE_REPO_ROOT };
