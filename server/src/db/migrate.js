const path = require('path');
const { migrate } = require('drizzle-orm/postgres-js/migrator');

const MIGRATIONS_FOLDER = path.join(__dirname, '../../drizzle');

/**
 * @param {import('drizzle-orm/postgres-js').PostgresJsDatabase} db
 */
async function runMigrations(db) {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

module.exports = { runMigrations, MIGRATIONS_FOLDER };
