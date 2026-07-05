const { defineConfig } = require('drizzle-kit');

module.exports = defineConfig({
    schema: './src/db/schema.js',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL || 'postgres://xensemble:xensemble@127.0.0.1:5432/xensemble',
    },
});
