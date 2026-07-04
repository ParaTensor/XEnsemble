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

module.exports = {
    getAgentDefinition,
    getAgentResume,
    getAgentResumeLevel,
    isAgentResumable,
};
