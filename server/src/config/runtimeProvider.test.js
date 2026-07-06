const { test } = require('node:test');
const assert = require('node:assert/strict');

function loadModule() {
    const key = require.resolve('../config/runtimeProvider');
    delete require.cache[key];
    return require('../config/runtimeProvider');
}

test('defaults to boxlite when RUNTIME_PROVIDER is unset', () => {
    delete process.env.RUNTIME_PROVIDER;
    const mod = loadModule();
    assert.equal(mod.resolveRuntimeProvider(), 'boxlite');
});

test('honors explicit RUNTIME_PROVIDER override', () => {
    process.env.RUNTIME_PROVIDER = 'local';
    const mod = loadModule();
    assert.equal(mod.resolveRuntimeProvider(), 'local');
    delete process.env.RUNTIME_PROVIDER;
});
