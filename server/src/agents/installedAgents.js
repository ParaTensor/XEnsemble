const { db } = require('../db/index');
const schema = require('../db/schema');
const { probeAgent } = require('./agentProbe');
const { resolveRuntimeProvider } = require('../config/runtimeProvider');
const { eq, and } = require('drizzle-orm');

async function listInstalledAgentRows() {
    const rows = await db.select().from(schema.agents);
    if (resolveRuntimeProvider() === 'boxlite') {
        const activeRefs = await db.select({ agentId: schema.agentBoxImages.agentId })
            .from(schema.agentBoxImages)
            .where(and(
                eq(schema.agentBoxImages.isActive, true),
                eq(schema.agentBoxImages.status, 'ready'),
            ));
        const activeSet = new Set(activeRefs.map((r) => r.agentId));
        const { AGENT_BOX_IMAGE_CATALOG } = require('../runtime/agentBoxImages');
        return rows.filter((row) => {
            if (activeSet.has(row.id)) return true;
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
