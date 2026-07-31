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

module.exports = {
    hasServiceBlock,
    hasBinding,
    appendAgentService,
};
