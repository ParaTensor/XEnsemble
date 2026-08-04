/**
 * Pure TOML helpers for UniGateway service/binding sync.
 * Split from agentServiceSync.js so they can be unit-tested without a DB.
 */

const BINDINGS_TABLE = /^\[\[bindings\]\]\s*$/;
const TABLE_HEADER = /^\[\[.*\]\]\s*$/;

function tableValue(blockLines, key) {
    const re = new RegExp(`^${key}\\s*=\\s*"([^"]*)"\\s*$`);
    for (const line of blockLines) {
        const m = line.match(re);
        if (m) return m[1];
    }
    return undefined;
}

/**
 * Iterate every [[bindings]] table in the TOML, yielding its body lines.
 * Uses line-by-line section parsing (not a loose cross-block regex) so that
 * `service_id = "<agent>"` entries inside [[api_keys]] tables can never be
 * mistaken for bindings, and so every binding table is visited exactly once.
 */
function forEachBindingsTable(content, cb) {
    const lines = String(content || '').split('\n');
    let current = null;
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (TABLE_HEADER.test(line)) {
            if (current) {
                cb(current, start, i);
                current = null;
            }
            if (BINDINGS_TABLE.test(line)) {
                current = [];
                start = i;
            }
            continue;
        }
        if (current) current.push(line);
    }
    if (current) cb(current, start, lines.length);
}

function hasServiceBlock(content, agentId) {
    return new RegExp(`\\bid\\s*=\\s*"${agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(content);
}

function hasBinding(content, agentId, providerName) {
    const safeId = String(agentId || '').replace(/"/g, '');
    const safeProvider = String(providerName || '').replace(/"/g, '');
    let found = false;
    forEachBindingsTable(content, (block) => {
        if (tableValue(block, 'service_id') === safeId && tableValue(block, 'provider_name') === safeProvider) {
            found = true;
        }
    });
    return found;
}

function removeBindingsForService(content, agentId) {
    const safeId = String(agentId || '').replace(/"/g, '');
    if (!safeId) return content;

    const lines = String(content || '').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (BINDINGS_TABLE.test(line)) {
            const block = [line];
            let j = i + 1;
            while (j < lines.length && !TABLE_HEADER.test(lines[j])) {
                block.push(lines[j]);
                j++;
            }
            const serviceId = tableValue(block.slice(1), 'service_id');
            if (serviceId === safeId) {
                i = j;
                continue;
            }
            out.push(...block);
            i = j;
            continue;
        }
        out.push(line);
        i++;
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function appendAgentService(content, agentId, providerName) {
    const safeId = String(agentId || '').replace(/"/g, '');
    const safeProvider = String(providerName || '').replace(/"/g, '');
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
    return `${String(content).replace(/\s*$/, '')}\n${blocks.join('\n')}\n`;
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
