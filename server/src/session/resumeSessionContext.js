const { eq } = require('drizzle-orm');
const { getAgentResume, getAgentResumeLevel } = require('../agents/agentResume');
const { resolveSpawnEnv } = require('../agents/agentEnv');

async function buildResumeSessionContext({
    requestUser,
    requestLog,
    session,
    terminalThemeId = null,
    db,
    schema,
    getProjectForUser,
    agentGatewayConfig,
    issueSessionToken,
}) {
    const project = session.projectId ? await getProjectForUser(requestUser.id, session.projectId) : null;
    if (!project) {
        const error = new Error('Project not found');
        error.statusCode = 404;
        throw error;
    }

    const dbAgents = await db.select().from(schema.agents).where(eq(schema.agents.id, session.agentId));
    if (dbAgents.length === 0) {
        const error = new Error('Agent not found');
        error.statusCode = 404;
        throw error;
    }

    const agentRow = dbAgents[0];
    const agentMeta = {
        ...agentRow,
        args: JSON.parse(agentRow.args),
        env_required: JSON.parse(agentRow.envRequired),
    };
    const resumeSpec = getAgentResume(agentMeta.id);
    if (getAgentResumeLevel(agentMeta.id) !== 'L2' || !resumeSpec?.stateEnv || !session.stateDirRef || !session.recoverable) {
        const error = new Error('session not resumable — please start a new session');
        error.statusCode = 409;
        throw error;
    }

    const authMode = await agentGatewayConfig.getAgentAuthMode(agentMeta.id);
    let sessionToken = null;
    if (authMode === 'gateway') {
        const gwCfg = await agentGatewayConfig.getForAgent(agentMeta.id);
        sessionToken = issueSessionToken({
            sessionId: session.id,
            userId: requestUser.id,
            projectId: project.id,
            agentId: agentMeta.id,
            model: gwCfg?.model,
            role: requestUser.role,
        });
    }

    const resolvedSpawnEnv = await resolveSpawnEnv({
        userId: requestUser.id,
        agentId: agentMeta.id,
        envRequired: agentMeta.env_required,
        sessionToken,
        projectId: project.id,
        terminalThemeId,
        warn: (msg) => requestLog?.warn?.(msg),
    });
    if (!resolvedSpawnEnv.env) {
        const error = new Error(resolvedSpawnEnv.error || 'Failed to resolve spawn environment');
        error.statusCode = 400;
        throw error;
    }

    if (project.repoProvider === 'github') {
        resolvedSpawnEnv.env.XENSEMBLE_GIT_BRANCH = project.currentBranch || '';
        resolvedSpawnEnv.env.XENSEMBLE_GIT_BASE_BRANCH = project.repoDefaultBranch || '';
        resolvedSpawnEnv.env.XENSEMBLE_REPO_URL = project.githubFullName || '';
    }

    return {
        project,
        agentMeta,
        terminalThemeId,
        resolvedSpawnEnv,
        sessionToken,
        requestUser,
    };
}

module.exports = { buildResumeSessionContext };
