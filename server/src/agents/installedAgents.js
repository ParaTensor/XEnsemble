const { db } = require('../db/index');
const schema = require('../db/schema');
const { probeAgent } = require('./agentProbe');

async function listInstalledAgentRows() {
    const rows = await db.select().from(schema.agents);
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
