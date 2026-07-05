#!/usr/bin/env node
require('../src/db/index');
const { db } = require('../src/db/index');
const { runMigrations } = require('../src/db/migrate');

runMigrations(db)
    .then(() => {
        console.log('Migrations applied.');
        process.exit(0);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
