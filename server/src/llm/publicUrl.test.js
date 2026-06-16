const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PORT } = require('../config/defaultPort');
const {
    resolveControlPlanePublicUrlSync,
    resolveLlmPublicRouterBaseSync,
} = require('./publicUrl');

describe('publicUrl', () => {
    const original = process.env.CONTROL_PLANE_PUBLIC_URL;
    const originalPort = process.env.PORT;

    afterEach(() => {
        if (original == null) delete process.env.CONTROL_PLANE_PUBLIC_URL;
        else process.env.CONTROL_PLANE_PUBLIC_URL = original;
        if (originalPort == null) delete process.env.PORT;
        else process.env.PORT = originalPort;
    });

    it('defaults to localhost control plane', () => {
        delete process.env.CONTROL_PLANE_PUBLIC_URL;
        delete process.env.PORT;
        assert.equal(resolveControlPlanePublicUrlSync(), `http://127.0.0.1:${DEFAULT_PORT}`);
        assert.equal(resolveLlmPublicRouterBaseSync(), `http://127.0.0.1:${DEFAULT_PORT}/api/v1/llm`);
    });

    it('honors CONTROL_PLANE_PUBLIC_URL without trailing slash', () => {
        process.env.CONTROL_PLANE_PUBLIC_URL = 'https://app.example.com/';
        assert.equal(resolveControlPlanePublicUrlSync(), 'https://app.example.com');
        assert.equal(resolveLlmPublicRouterBaseSync(), 'https://app.example.com/api/v1/llm');
    });
});
