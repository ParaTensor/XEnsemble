const fs = require('fs');
const path = require('path');
const { eq, and, inArray } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const policy = require('../auth/PolicyService');
const unigateway = require('../gateway/unigatewayManager');
const { resolveSpawnEnv, findMissing } = require('../agents/agentEnv');
const { readSetupStatus } = require('./agentBootstrap');
const { readResumeStatus } = require('./agentResumeHook');
const { getPreviewPort } = require('./previewPorts');
const { projectDir } = require('../workspace');

function checkOk(extra = {}) {
    return { ok: true, ...extra };
}

function checkFail(message, extra = {}) {
    return { ok: false, message, ...extra };
}

function collectHints(checks) {
    const hints = [];
    if (checks.user?.ok === false) hints.push(checks.user.message || 'User account is not active.');
    if (checks.secrets?.ok === false && checks.secrets.missing?.length) {
        hints.push(`Configure secrets: ${checks.secrets.missing.join(', ')}`);
    }
    if (checks.gateway?.ok === false) hints.push(checks.gateway.message || 'Start or configure UniGateway.');
    if (checks.llm_router?.ok === false) hints.push(checks.llm_router.message || 'Configure LLM router URL/key.');
    if (checks.workspace_setup?.ok === false) hints.push(checks.workspace_setup.message || 'Run .agents/setup or POST /agents/setup.');
    if (checks.workspace_resume?.ok === false && checks.workspace_resume.message) {
        hints.push(checks.workspace_resume.message);
    }
    if (checks.preview?.ok === false && checks.preview.message) hints.push(checks.preview.message);
    if (checks.quota?.ok === false && checks.quota.message) hints.push(checks.quota.message);
    return hints;
}

async function checkGateway() {
    const status = unigateway.getStatus();
    if (!status.running) {
        return checkFail('UniGateway is not running', { running: false, base_url: status.baseUrl || null });
    }
    return checkOk({ running: true, base_url: status.baseUrl || null });
}

async function checkPreview(projectId, userId, workspacePath) {
    const rows = await db.select().from(schema.deployments)
        .where(and(
            eq(schema.deployments.projectId, projectId),
            eq(schema.deployments.userId, userId),
            eq(schema.deployments.kind, 'preview'),
            inArray(schema.deployments.status, ['pending', 'building', 'running']),
        ));
    if (rows.length === 0) {
        return checkFail('No active preview deployment', {
            deployment_count: 0,
            ensure: 'POST /api/v1/projects/:id/agents/ensure-preview',
        });
    }
    const running = rows.find((r) => r.status === 'running');
    if (!running) {
        return checkFail('Preview is starting', {
            deployment_count: rows.length,
            status: rows[0].status,
        });
    }
    const portMeta = workspacePath ? getPreviewPort(workspacePath, running.id) : null;
    return checkOk({
        deployment_id: running.id,
        public_url: running.publicUrl || portMeta?.public_url || null,
        internal_ref: running.internalRef || portMeta?.internal_ref || null,
        ports_file: portMeta ? `.agents/ports.json#${running.id}` : null,
    });
}

async function checkSecrets(user, agentId) {
    if (!agentId) {
        return checkOk({ skipped: true, reason: 'no_agent_id' });
    }
    const agentRows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    if (agentRows.length === 0) {
        return checkFail('Agent not found', { agent_id: agentId });
    }
    const envRequired = JSON.parse(agentRows[0].envRequired || '[]');
    if (envRequired.length === 0) {
        return checkOk({ agent_id: agentId, required: [] });
    }
    try {
        const resolved = await resolveSpawnEnv({
            userId: user.id,
            agentId,
            envRequired,
            forPreview: true,
        });
        if (resolved.error) {
            return checkFail(resolved.error, {
                agent_id: agentId,
                missing: resolved.missing || [],
                mode: resolved.mode,
            });
        }
        const missing = resolved.missing?.length
            ? resolved.missing
            : findMissing(resolved.env || {}, envRequired);
        if (missing.length > 0) {
            return checkFail('Missing required secrets', { agent_id: agentId, missing, mode: resolved.mode });
        }
        return checkOk({ agent_id: agentId, required: envRequired, mode: resolved.mode });
    } catch (err) {
        return checkFail(err.message || 'Failed to resolve agent secrets', { agent_id: agentId });
    }
}

function checkWorkspaceSetup(project, workspacePath) {
    const status = readSetupStatus(workspacePath);
    if (!status) {
        return checkFail('Workspace setup has not run yet', {
            setup_script: '.agents/setup',
            run: 'POST /api/v1/projects/:id/agents/setup',
        });
    }
    if (status.status === 'failed') {
        return checkFail('Workspace setup failed', {
            exit_code: status.exit_code,
            log_tail: status.log_tail,
        });
    }
    return checkOk({
        status: status.status,
        snapshot_id: status.snapshot_id || null,
        finished_at: status.finished_at || null,
    });
}

function checkWorkspaceResume(workspacePath) {
    const status = readResumeStatus(workspacePath);
    if (!status) {
        return checkOk({
            skipped: true,
            reason: 'no_wake_yet',
            run: 'POST /api/v1/projects/:id/agents/resume',
        });
    }
    if (status.status === 'failed') {
        return checkFail('Workspace resume failed', {
            exit_code: status.exit_code,
            log_tail: status.log_tail,
        });
    }
    return checkOk({
        status: status.status,
        session_id: status.session_id || null,
        preview: status.preview || null,
        finished_at: status.finished_at || null,
    });
}

async function checkQuota(user) {
    if (user.role === 'admin') {
        return checkOk({ admin: true });
    }
    const quota = await policy.getEffectiveQuota(user.id);
    const exceeded = [];
    if (quota.usage.projects >= quota.max_projects) exceeded.push('projects');
    if (quota.usage.sessions >= quota.max_sessions) exceeded.push('sessions');
    if (quota.usage.previews >= quota.max_previews) exceeded.push('previews');
    if (exceeded.length > 0) {
        return checkFail(`Quota exceeded: ${exceeded.join(', ')}`, { quota });
    }
    return checkOk({ quota });
}

async function checkLlmRouter() {
    try {
        const secrets = unigateway.ensureGatewaySecrets();
        const status = unigateway.getStatus();
        const routerUrl = process.env.CONTROL_PLANE_PUBLIC_URL
            ? `${process.env.CONTROL_PLANE_PUBLIC_URL.replace(/\/$/, '')}/api/v1/llm`
            : null;
        if (!secrets.gatewayKey) {
            return checkFail('Gateway key is not configured');
        }
        return checkOk({
            gateway_running: status.running,
            router_url: routerUrl,
        });
    } catch (err) {
        return checkFail(err.message || 'LLM router is not configured');
    }
}

/**
 * @param {{ user: object, project: object, agentId?: string|null, workspacePath?: string|null }} input
 */
function computeReady(checks, agentId) {
    const required = ['user', 'workspace', 'workspace_setup', 'quota'];
    if (agentId) {
        required.push('secrets', 'llm_router', 'gateway');
    }
    return required.every((key) => checks[key]?.ok);
}

async function buildPreflightReport({ user, project, agentId = null, workspacePath = null }) {
    const wsPath = workspacePath || project.serverPath || projectDir(user.id, project.id);

    const checks = {
        user: user.status === 'active'
            ? checkOk({ status: user.status, role: user.role })
            : checkFail('Account is not active', { status: user.status }),
        secrets: await checkSecrets(user, agentId),
        gateway: await checkGateway(),
        llm_router: await checkLlmRouter(),
        preview: await checkPreview(project.id, user.id, wsPath),
        quota: await checkQuota(user),
        workspace_setup: checkWorkspaceSetup(project, wsPath),
        workspace_resume: checkWorkspaceResume(wsPath),
    };

    if (fs.existsSync(wsPath)) {
        checks.workspace = checkOk({ path: wsPath });
    } else {
        checks.workspace = checkFail('Workspace directory is missing', { path: wsPath });
    }

    const hints = collectHints(checks);
    const ready = computeReady(checks, agentId);

    return {
        ready,
        project_id: project.id,
        agent_id: agentId || null,
        workspace_path: wsPath,
        checks,
        hints,
        endpoints: {
            setup: `/api/v1/projects/${project.id}/agents/setup`,
            resume: `/api/v1/projects/${project.id}/agents/resume`,
            ensure_preview: `/api/v1/projects/${project.id}/agents/ensure-preview`,
            preflight: `/api/v1/projects/${project.id}/preflight`,
            agent_log: `/api/v1/projects/${project.id}/agents/log`,
            spawn_preview: '/api/v1/session/spawn-preview',
        },
    };
}

module.exports = {
    buildPreflightReport,
    collectHints,
    computeReady,
};
