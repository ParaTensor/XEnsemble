const { db } = require('../db/index');
const schema = require('../db/schema');
const { probeAgent } = require('./agentProbe');
const { resolveRuntimeProvider } = require('../config/runtimeProvider');

async function listInstalledAgentRows() {
    const rows = await db.select().from(schema.agents);
    if (resolveRuntimeProvider() === 'boxlite') {
        const { AGENT_BOX_IMAGE_CATALOG } = require('../runtime/agentBoxImages');
        return rows.filter((row) => {
            const catalog = AGENT_BOX_IMAGE_CATALOG[row.id];
            return !catalog || catalog.buildable !== false;
        });
    }
    return rows.filter((row) => probeAgent(row.cmd).installed);
}

async function listInstalledAgentIds() {
    const rows = await listInstalledAgentRows();
    return rows.map((row) => row.id);
}

module.exports = {
    listInstalledAgentRows,
    listInstalledAgentIds,
};
