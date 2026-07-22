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
 * `exited` when its process/attach drops). Requires an L2 agent with a state
 * mechanism (stateEnv, stateArgs, or redirectHome) and a persisted state
 * directory reference on the session.
 */
function isSessionRecoverable(session) {
    if (!session) return false;
    const spec = getAgentResume(session.agentId);
    return (
        (spec.level || 'L0') === 'L2'
        && Boolean(spec.stateEnv || spec.stateArgs || spec.redirectHome)
        && Boolean(session.stateDirRef)
    );
}

/**
 * Build the CLI args to inject for state directory redirection.
 * For agents that use a CLI flag (e.g. --config-dir <path>) instead of an env var.
 */
function buildStateArgs(resumeSpec, stateDirPath) {
    if (!resumeSpec?.stateArgs || !stateDirPath) return [];
    return [...resumeSpec.stateArgs, stateDirPath];
}

/**
 * Whether the agent needs HOME redirected to the state directory.
 */
function needsHomeRedirect(resumeSpec) {
    return Boolean(resumeSpec?.redirectHome);
}

module.exports = {
    getAgentDefinition,
    getAgentResume,
    getAgentResumeLevel,
    isAgentResumable,
    isSessionRecoverable,
    buildStateArgs,
    needsHomeRedirect,
};
