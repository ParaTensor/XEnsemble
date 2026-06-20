const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('runtime registry provider selection', () => {
    test('local provider is the default', () => {
        const registry = loadRegistry();
        const rt = registry.getRuntime();
        assert.equal(rt.provider.constructor.name, 'LocalRuntimeProvider');
        assert.equal(rt.exec.constructor.name, 'LocalExecAdapter');
        assert.equal(rt.fs.constructor.name, 'LocalFsAdapter');
        assert.equal(rt.preview.constructor.name, 'LocalPreviewAdapter');
    });

    test('boxlite provider returns stubs', () => {
        const registry = loadRegistry('boxlite');
        const rt = registry.getRuntime();
        assert.equal(rt.provider.constructor.name, 'BoxLiteRuntimeProvider');
        assert.equal(rt.exec.constructor.name, 'BoxLiteExecAdapter');
        assert.equal(rt.fs.constructor.name, 'BoxLiteFsAdapter');
        assert.equal(rt.preview.constructor.name, 'BoxLitePreviewAdapter');
    });

    test('k8s provider returns stubs', () => {
        const registry = loadRegistry('k8s');
        const rt = registry.getRuntime();
        assert.equal(rt.provider.constructor.name, 'K8sRuntimeProvider');
        assert.equal(rt.exec.constructor.name, 'K8sExecAdapter');
        assert.equal(rt.fs.constructor.name, 'K8sFsAdapter');
        assert.equal(rt.preview.constructor.name, 'K8sPreviewAdapter');
    });

    test('unknown provider throws', () => {
        assert.throws(() => loadRegistry('unknown').getRuntime(), /Unknown RUNTIME_PROVIDER/);
    });
});

function loadRegistry(provider) {
    // Force re-evaluation of registry module by clearing require cache.
    const key = require.resolve('./registry');
    delete require.cache[key];
    if (provider != null) {
        process.env.RUNTIME_PROVIDER = provider;
    } else {
        delete process.env.RUNTIME_PROVIDER;
    }
    return require('./registry');
}
