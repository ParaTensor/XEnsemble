const { eq, inArray } = require('drizzle-orm');

/**
 * Startup reconciliation for custom image builds. Builds run inside the
 * control-plane process; a restart abandons any in-flight `building` (or still
 * `queued`) rows. Since the executor state is in-memory only, these rows would
 * otherwise be stuck forever. Mark them `failed` so their status is settled and
 * the owning image reflects a terminal state. Callers may re-request a build.
 *
 * @param {import('drizzle-orm/postgres-js').PostgresJsDatabase} db
 * @param {object} schema
 * @returns {Promise<{ reconciled: number, ids: string[] }>}
 */
async function reconcileCustomImageBuilds(db, schema) {
  const stale = await db
    .select({ id: schema.customImageBuilds.id })
    .from(schema.customImageBuilds)
    .where(inArray(schema.customImageBuilds.state, ['queued', 'building']));

  const staleIds = stale.map((row) => row.id);
  if (staleIds.length > 0) {
    await db
      .update(schema.customImageBuilds)
      .set({
        state: 'failed',
        failureReason: 'Build interrupted by server restart',
        finishedAt: Date.now(),
      })
      .where(inArray(schema.customImageBuilds.id, staleIds));
  }

  return { reconciled: staleIds.length, ids: staleIds };
}

module.exports = { reconcileCustomImageBuilds };
