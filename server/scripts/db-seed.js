#!/usr/bin/env node
require('../src/db/index');
const { db } = require('../src/db/index');
const { seedIfNeeded } = require('../src/db/seed');

seedIfNeeded(db)
    .then(() => {
        console.log('Seed completed.');
        process.exit(0);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
