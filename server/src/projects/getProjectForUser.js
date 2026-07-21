const { eq } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');

// Short-TTL cache for getProjectForUser results.
// Avoids 5-10 redundant DB queries per page load (each API route calls it).
const CACHE_TTL_MS = 5_000;
const cache = new Map(); // projectId -> { project, expiresAt }

function invalidateProjectCache(projectId) {
    if (projectId) {
        cache.delete(projectId);
    } else {
        cache.clear();
    }
}

async function getProjectForUser(userId, projectId) {
    if (!projectId) return null;

    // Check cache first. Still verify ownership even on cache hit.
    const cached = cache.get(projectId);
    if (cached && cached.expiresAt > Date.now()) {
        if (!cached.project || cached.project.userId !== userId) return null;
        return cached.project;
    }
    if (cached) cache.delete(projectId);

    const rows = await db.select().from(schema.projects)
        .where(eq(schema.projects.id, projectId));
    if (rows.length === 0 || rows[0].userId !== userId) return null;

    const project = rows[0];
    cache.set(projectId, { project, expiresAt: Date.now() + CACHE_TTL_MS });
    return project;
}

module.exports = { getProjectForUser, invalidateProjectCache };
