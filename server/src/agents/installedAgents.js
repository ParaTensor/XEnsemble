const { db } = require('../db/index');
const schema = require('../db/schema');
const { probeAgent } = require('./agentProbe');
const { resolveRuntimeProvider } = require('../config/runtimeProvider');
const { eq, and } = require('drizzle-orm');
const { resolveBoxImage } = require('../runtime/agentBoxImages');

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
        const result = [];
        for (const row of rows) {
            if (activeSet.has(row.id)) {
                result.push(row);
                continue;
            }
            try {
                const image = await resolveBoxImage({ agentId: row.id });
                if (image != null) result.push(row);
            } catch {
                // resolveBoxImage failed, skip this agent
            }
        }
        return result;
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
