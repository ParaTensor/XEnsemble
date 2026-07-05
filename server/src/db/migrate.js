const path = require('path');
const { migrate } = require('drizzle-orm/postgres-js/migrator');

const MIGRATIONS_FOLDER = path.join(__dirname, '../../drizzle');

/**
 * @param {import('drizzle-orm/postgres-js').PostgresJsDatabase} db
 */
async function runMigrations(db) {
    // PlanetScale 等托管库的应用 role 通常无 CREATE SCHEMA 权限；迁移表放在 public。
    await migrate(db, {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: 'public',
    });
}

module.exports = { runMigrations, MIGRATIONS_FOLDER };
