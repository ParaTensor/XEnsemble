const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { seedAgentWorkspaceFiles } = require('./agentBootstrap');
const deploymentService = require('../deployments/DeploymentService');

const execFileAsync = promisify(execFile);

const RESUME_SCRIPT = 'resume';
const RESUME_STATUS_FILE = 'resume-status.json';
const RESUME_TIMEOUT_MS = Number(process.env.AGENT_RESUME_TIMEOUT_MS || 120000);
const LOG_TAIL_MAX = 8000;

const DEFAULT_RESUME_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
# XEnsemble workspace resume — safe to re-run after idle-hibernate / wake.
# Control plane also runs ensure-preview server-side; add custom reconnect logic here.
echo "[xensemble] workspace resume complete"
`;

function resumeScriptPath(workspacePath) {
    return path.join(workspacePath, '.agents', RESUME_SCRIPT);
}

function resumeStatusPath(workspacePath) {
    return path.join(workspacePath, '.agents', RESUME_STATUS_FILE);
}

function hashResumeContent(content) {
    return crypto.createHash('sha256').update(content || '').digest('hex');
}

function readResumeStatus(workspacePath) {
    const filePath = resumeStatusPath(workspacePath);
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function writeResumeStatus(workspacePath, payload) {
    const dir = path.dirname(resumeStatusPath(workspacePath));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resumeStatusPath(workspacePath), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return payload;
}

function tailLog(text) {
    if (!text) return '';
    const s = String(text);
    return s.length <= LOG_TAIL_MAX ? s : s.slice(-LOG_TAIL_MAX);
}

function seedResumeScript(workspacePath) {
    const scriptPath = resumeScriptPath(workspacePath);
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    if (!fs.existsSync(scriptPath)) {
        fs.writeFileSync(scriptPath, DEFAULT_RESUME_SCRIPT, { mode: 0o755 });
    }
}

function shouldRunResume(workspacePath, { force = false, onWake = false } = {}) {
    if (force || onWake) return true;
    const scriptPath = resumeScriptPath(workspacePath);
    if (!fs.existsSync(scriptPath)) return false;

    const scriptHash = hashResumeContent(fs.readFileSync(scriptPath, 'utf8'));
    const prev = readResumeStatus(workspacePath);
    if (!prev) return true;
    if (prev.status !== 'completed' && prev.status !== 'skipped') return true;
    if (prev.resume_hash !== scriptHash) return true;
    return false;
}

async function runResumeScript(workspacePath, project, options = {}) {
    const scriptPath = resumeScriptPath(workspacePath);
    if (!fs.existsSync(scriptPath)) {
        return {
            status: 'skipped',
            exit_code: 0,
            resume_hash: null,
            log_tail: '',
            reason: 'no_resume_script',
        };
    }

    const resumeHash = hashResumeContent(fs.readFileSync(scriptPath, 'utf8'));
    try {
        fs.chmodSync(scriptPath, 0o755);
    } catch {
        // best effort
    }

    const startedAt = Date.now();
    const env = {
        ...process.env,
        XENSEMBLE_WORKSPACE: workspacePath,
        XENSEMBLE_PROJECT_ID: project.id,
        XENSEMBLE_USER_ID: project.userId,
    };
    if (options.sessionId) env.XENSEMBLE_SESSION_ID = options.sessionId;

    try {
        const { stdout, stderr } = await execFileAsync('/bin/bash', [scriptPath], {
            cwd: workspacePath,
            timeout: RESUME_TIMEOUT_MS,
            maxBuffer: 1024 * 1024,
            env,
        });
        return {
            status: 'completed',
            exit_code: 0,
            resume_hash: resumeHash,
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
            resume_hash: resumeHash,
            log_tail: tailLog(`${stdout}${stderr}${err.message || ''}`),
            started_at: startedAt,
            finished_at: Date.now(),
        };
    }
}

/**
 * Run `.agents/resume` when needed and rebuild volatile preview state.
 * Failures are recorded but do not throw — session wake should continue.
 */
async function ensureAgentResume(project, workspacePath, options = {}) {
    seedAgentWorkspaceFiles(workspacePath);
    seedResumeScript(workspacePath);

    let scriptResult = {
        status: 'skipped',
        exit_code: 0,
        resume_hash: null,
        log_tail: '',
        reason: 'not_needed',
    };

    if (options.runScript !== false && shouldRunResume(workspacePath, options)) {
        scriptResult = await runResumeScript(workspacePath, project, options);
    } else if (readResumeStatus(workspacePath)) {
        scriptResult = readResumeStatus(workspacePath);
    }

    let preview = null;
    if (options.ensurePreview !== false) {
        try {
            preview = await deploymentService.ensurePreview(project.userId, project);
        } catch (err) {
            preview = { error: err instanceof Error ? err.message : String(err) };
        }
    }

    return writeResumeStatus(workspacePath, {
        version: 1,
        status: scriptResult.status,
        exit_code: scriptResult.exit_code,
        resume_hash: scriptResult.resume_hash,
        reason: scriptResult.reason || null,
        log_tail: scriptResult.log_tail || '',
        session_id: options.sessionId || null,
        preview: preview ? {
            ensured: preview.ensured || null,
            deployment_id: preview.id || null,
            error: preview.error || null,
        } : null,
        started_at: scriptResult.started_at || Date.now(),
        finished_at: Date.now(),
    });
}

module.exports = {
    RESUME_SCRIPT,
    RESUME_STATUS_FILE,
    seedResumeScript,
    shouldRunResume,
    readResumeStatus,
    ensureAgentResume,
    hashResumeContent,
};
