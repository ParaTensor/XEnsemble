const { DEFAULT_AGENTS } = require('./defaultAgents');

const DEFAULT_RESUME = { level: 'L0' };
const DEFAULT_AGENT_BY_ID = new Map(DEFAULT_AGENTS.map((agent) => [agent.id, agent]));

function getAgentDefinition(agentId) {
    return DEFAULT_AGENT_BY_ID.get(agentId) || null;
}

function getAgentResume(agentId) {
    const agent = getAgentDefinition(agentId);
    return agent?.resume || DEFAULT_RESUME;
}

function getAgentResumeLevel(agentId) {
    return getAgentResume(agentId).level || 'L0';
}

function isAgentResumable(agentId) {
    return getAgentResumeLevel(agentId) === 'L2';
}

/**
 * Whether a session should be treated as recoverable (kept as `idle` instead of
 * `exited` when its process/attach drops). Requires an L2 agent with a state env
 * and a persisted state directory reference on the session.
 */
function isSessionRecoverable(session) {
    if (!session) return false;
    const spec = getAgentResume(session.agentId);
    return (
        (spec.level || 'L0') === 'L2'
        && Boolean(spec.stateEnv)
        && Boolean(session.stateDirRef)
    );
}

module.exports = {
    getAgentDefinition,
    getAgentResume,
    getAgentResumeLevel,
    isAgentResumable,
    isSessionRecoverable,
};
