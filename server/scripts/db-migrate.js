#!/usr/bin/env node
const { resetConnection, closeConnection } = require('../src/db/index');
const { runMigrations } = require('../src/db/migrate');

const migrateUrl = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;

async function main() {
    const { db } = await resetConnection(migrateUrl);
    try {
        await runMigrations(db);
        console.log('Migrations applied.');
    } finally {
        await closeConnection();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
