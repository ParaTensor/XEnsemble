/**
 * Pure TOML helpers for UniGateway service/binding sync.
 * Split from agentServiceSync.js so they can be unit-tested without a DB.
 */

function hasServiceBlock(content, agentId) {
    return new RegExp(`\\bid\\s*=\\s*"${agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(content);
}

function hasBinding(content, agentId, providerName) {
    const servicePattern = new RegExp(
        `service_id\\s*=\\s*"${agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?provider_name\\s*=\\s*"${providerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
    );
    return servicePattern.test(content);
}

function removeBindingsForService(content, agentId) {
    const safeId = String(agentId || '').replace(/"/g, '');
    if (!safeId) return content;
    // Remove each [[bindings]] table whose service_id matches the agent.
    const bindingBlock = /(?:^|\n)\[\[bindings\]\][^\[]*/g;
    return content.replace(bindingBlock, (block) => {
        const serviceMatch = block.match(/service_id\s*=\s*"([^"]+)"/);
        if (serviceMatch && serviceMatch[1] === safeId) {
            return block.startsWith('\n') ? '\n' : '';
        }
        return block;
    }).replace(/\n{3,}/g, '\n\n');
}

function appendAgentService(content, agentId, providerName) {
    const safeId = agentId.replace(/"/g, '');
    const safeProvider = providerName.replace(/"/g, '');
    const blocks = [];

    if (!hasServiceBlock(content, safeId)) {
        blocks.push(
            '',
            '[[services]]',
            `id = "${safeId}"`,
            `name = "${safeId}"`,
            'routing_strategy = "round_robin"',
        );
    }
    if (!hasBinding(content, safeId, safeProvider)) {
        blocks.push(
            '',
            '[[bindings]]',
            `service_id = "${safeId}"`,
            `provider_name = "${safeProvider}"`,
            'priority = 0',
        );
    }
    if (blocks.length === 0) return content;
    return `${content.replace(/\s*$/, '')}\n${blocks.join('\n')}\n`;
}

/**
 * Ensure the agent has exactly one active provider binding (replace, not append).
 * Switching provider A → B removes the stale A binding.
 */
function upsertAgentServiceBinding(content, agentId, providerName) {
    const withoutStale = removeBindingsForService(content, agentId);
    return appendAgentService(withoutStale, agentId, providerName);
}

module.exports = {
    hasServiceBlock,
    hasBinding,
    removeBindingsForService,
    appendAgentService,
    upsertAgentServiceBinding,
};
