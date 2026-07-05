const path = require('path');
const { sql } = require('drizzle-orm');
const { readMigrationFiles } = require('drizzle-orm/migrator');

const MIGRATIONS_FOLDER = path.join(__dirname, '../../drizzle');
const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * 不调用 drizzle 内置 migrate()，避免 `CREATE SCHEMA`（PlanetScale 应用 role 无此权限）。
 * 迁移追踪表放在 public；首次 migrate 仍需 MIGRATE_DATABASE_URL（默认 postgres role）。
 *
 * @param {import('drizzle-orm/postgres-js').PostgresJsDatabase} db
 */
async function runMigrations(db) {
    await db.execute(sql.raw(`
        CREATE TABLE IF NOT EXISTS public.${MIGRATIONS_TABLE} (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
        )
    `));

    const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    const applied = await db.execute(
        sql.raw(`SELECT created_at FROM public.${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`),
    );
    const lastCreatedAt = applied[0] ? Number(applied[0].created_at) : null;

    for (const migration of migrations) {
        if (lastCreatedAt != null && lastCreatedAt >= migration.folderMillis) {
            continue;
        }
        for (const stmt of migration.sql) {
            const trimmed = stmt.trim();
            if (trimmed) {
                await db.execute(sql.raw(trimmed));
            }
        }
        await db.execute(
            sql`INSERT INTO ${sql.identifier(MIGRATIONS_TABLE)} (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
        );
    }
}

module.exports = { runMigrations, MIGRATIONS_FOLDER };
