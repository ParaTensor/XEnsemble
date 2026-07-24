const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { ensurePreviewContractFile } = require('../runtime/previewContract');
const repositoryEnvironment = require('../repositories/RepositoryEnvironmentService');

const execFileAsync = promisify(execFile);

const AGENTS_DIR = '.agents';
const SETUP_SCRIPT = 'setup';
const SETUP_STATUS_FILE = 'setup-status.json';
const AGENTS_MD_FILE = 'AGENTS.md';
const AGENTS_MD_VERSION = 2;
const SETUP_TIMEOUT_MS = Number(process.env.AGENT_SETUP_TIMEOUT_MS || 600000);
const LOG_TAIL_MAX = 8000;

const DEFAULT_SETUP_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
# XEnsemble workspace bootstrap — safe to re-run.
echo "[xensemble] workspace setup complete"
`;

function renderAgentsMd() {
    return `<!-- xensemble-agents-md v${AGENTS_MD_VERSION} -->
# XEnsemble workspace

This directory is managed by XEnsemble. Agents should not guess ports, login, setup state, or wake recovery.

## Sandbox

- Workspace root is your project files; \`.agents/\` holds platform hooks and metadata.
- Install extra tools with \`apt-get\` (BoxLite) or your stack's package manager when the runtime allows it.
- Session terminal I/O is persisted server-side as NDJSON under \`.transcript/\` (read-only from agent POV).

## Bootstrap (first run)

- Script: \`.agents/setup\` (idempotent)
- API: \`POST /api/v1/projects/:id/agents/setup\` — body \`{ "force": true }\` to re-run
- Status: \`.agents/setup-status.json\`

## Wake / resume (after idle-hibernate)

- Script: \`.agents/resume\` (idempotent) — runs automatically when a recoverable session wakes
- API: \`POST /api/v1/projects/:id/agents/resume\` — body \`{ "force": true }\` to re-run
- Status: \`.agents/resume-status.json\`
- Platform also calls ensure-preview server-side to restore dev preview

## Preflight

- \`GET /api/v1/projects/:id/preflight?agent_id=...\` — readiness JSON (secrets, gateway, LLM, preview, quotas, setup/resume)

## Preview

- Idempotent ensure: \`POST /api/v1/projects/:id/agents/ensure-preview\`
- Ports and URLs: \`.agents/ports.json\`
- Configure \`.agents/preview.json\` or use package.json \`dev\` / \`start\` / \`preview\` script

## Logs

- Aggregated dev logs: \`.agents/in/server.log\` — tags \`[preview]\`, \`[browser]\`
- Browser console: preview \`POST __dev/console\` (with preview token) or \`POST .../agents/log\`
`;
}

const DEFAULT_AGENTS_MD = renderAgentsMd();

function agentsDir(workspacePath) {
    return path.join(workspacePath, AGENTS_DIR);
}

function setupScriptPath(workspacePath) {
    return path.join(agentsDir(workspacePath), SETUP_SCRIPT);
}

function setupStatusPath(workspacePath) {
    return path.join(agentsDir(workspacePath), SETUP_STATUS_FILE);
}

function hashSetupContent(content) {
    return crypto.createHash('sha256').update(content || '').digest('hex');
}

function readSetupStatus(workspacePath) {
    const filePath = setupStatusPath(workspacePath);
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function writeSetupStatus(workspacePath, payload) {
    const dir = agentsDir(workspacePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(setupStatusPath(workspacePath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return payload;
}

function tailLog(text) {
    if (!text) return '';
    const s = String(text);
    return s.length <= LOG_TAIL_MAX ? s : s.slice(-LOG_TAIL_MAX);
}

function refreshAgentsMd(workspacePath) {
    const agentsMdPath = path.join(agentsDir(workspacePath), AGENTS_MD_FILE);
    if (!fs.existsSync(agentsMdPath)) {
        fs.writeFileSync(agentsMdPath, DEFAULT_AGENTS_MD, 'utf8');
        return;
    }
    const content = fs.readFileSync(agentsMdPath, 'utf8');
    const match = content.match(/<!-- xensemble-agents-md v(\d+) -->/);
    const currentVersion = match ? Number(match[1]) : 0;
    if (currentVersion < AGENTS_MD_VERSION) {
        fs.writeFileSync(agentsMdPath, DEFAULT_AGENTS_MD, 'utf8');
    }
}

/**
 * Idempotent: ensure workspace root `.gitignore` contains entries for `.agents/` and `.xensemble/`.
 * Appends missing entries without removing existing content.
 */
function ensureGitignoreEntries(workspacePath) {
    const ignorePath = path.join(workspacePath, '.gitignore');
    const entries = ['.agents/', '.xensemble/'];

    let content = '';
    if (fs.existsSync(ignorePath)) {
        content = fs.readFileSync(ignorePath, 'utf8');
    }

    const existingLines = new Set(content.split('\n').map((l) => l.trim()));
    const missing = entries.filter((e) => !existingLines.has(e));
    if (missing.length === 0) return;

    const block = `\n# XEnsemble platform metadata - do not commit\n${missing.join('\n')}\n`;
    const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(ignorePath, content + prefix + block, 'utf8');
}

/**
 * Idempotent: seed `.agents/setup`, `AGENTS.md`, resume script, and preview contract files.
 */
function seedAgentWorkspaceFiles(workspacePath) {
    const dir = agentsDir(workspacePath);
    fs.mkdirSync(dir, { recursive: true });

    const setupPath = setupScriptPath(workspacePath);
    if (!fs.existsSync(setupPath)) {
        fs.writeFileSync(setupPath, DEFAULT_SETUP_SCRIPT, { mode: 0o755 });
    }

    refreshAgentsMd(workspacePath);

    const { seedResumeScript } = require('./agentResumeHook');
    seedResumeScript(workspacePath);

    ensurePreviewContractFile(workspacePath);

    ensureGitignoreEntries(workspacePath);
}

function shouldRunSetup(workspacePath, { force = false } = {}) {
    if (force) return true;
    const scriptPath = setupScriptPath(workspacePath);
    if (!fs.existsSync(scriptPath)) return false;

    const scriptHash = hashSetupContent(fs.readFileSync(scriptPath, 'utf8'));
    const prev = readSetupStatus(workspacePath);
    if (!prev) return true;
    if (prev.status !== 'completed' && prev.status !== 'skipped') return true;
    if (prev.setup_hash !== scriptHash) return true;
    return false;
}

async function runSetupScript(workspacePath, project) {
    const scriptPath = setupScriptPath(workspacePath);
    if (!fs.existsSync(scriptPath)) {
        return {
            status: 'skipped',
            exit_code: 0,
            setup_hash: null,
            log_tail: '',
            reason: 'no_setup_script',
        };
    }

    const setupHash = hashSetupContent(fs.readFileSync(scriptPath, 'utf8'));
    try {
        fs.chmodSync(scriptPath, 0o755);
    } catch {
        // best effort
    }

    const startedAt = Date.now();
    try {
        const { stdout, stderr } = await execFileAsync('/bin/bash', [scriptPath], {
            cwd: workspacePath,
            timeout: SETUP_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
            env: {
                ...process.env,
                XENSEMBLE_WORKSPACE: workspacePath,
                XENSEMBLE_PROJECT_ID: project.id,
                XENSEMBLE_USER_ID: project.userId,
            },
        });
        return {
            status: 'completed',
            exit_code: 0,
            setup_hash: setupHash,
            log_tail: tailLog(`${stdout || ''}${stderr || ''}`),
            started_at: startedAt,
            finished_at: Date.now(),
        };
    } catch (err) {
        const stdout = err.stdout ? String(err.stdout) : '';
        const stderr = err.stderr ? String(err.stderr) : '';
        return {
            status: 'failed',
            exit_code: typeof err.code === 'number' ? err.code : 1,
            setup_hash: setupHash,
            log_tail: tailLog(`${stdout}${stderr}${err.message || ''}`),
            started_at: startedAt,
            finished_at: Date.now(),
        };
    }
}

/**
 * Run `.agents/setup` when needed and record snapshot metadata on success.
 * @returns {Promise<object>} setup-status payload
 */
async function ensureAgentBootstrap(project, workspacePath, options = {}) {
    seedAgentWorkspaceFiles(workspacePath);

    if (!shouldRunSetup(workspacePath, options)) {
        return readSetupStatus(workspacePath);
    }

    const result = await runSetupScript(workspacePath, project);
    let snapshotId = null;

    if (result.status === 'completed' || result.status === 'skipped') {
        const snap = await repositoryEnvironment.createSnapshot(project, {
            status: 'ready',
            storage_ref: `local:${workspacePath}`,
            build_log: result.log_tail || null,
        });
        snapshotId = snap.id;
    }

    return writeSetupStatus(workspacePath, {
        version: 1,
        status: result.status,
        exit_code: result.exit_code,
        setup_hash: result.setup_hash,
        snapshot_id: snapshotId,
        reason: result.reason || null,
        log_tail: result.log_tail || '',
        started_at: result.started_at || Date.now(),
        finished_at: result.finished_at || Date.now(),
    });
}

module.exports = {
    AGENTS_DIR,
    SETUP_SCRIPT,
    SETUP_STATUS_FILE,
    seedAgentWorkspaceFiles,
    shouldRunSetup,
    ensureAgentBootstrap,
    readSetupStatus,
    hashSetupContent,
};
