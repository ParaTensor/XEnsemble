const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
    resolveControlPlanePublicUrlSync,
    resolveLlmPublicRouterBaseSync,
} = require('./publicUrl');

describe('publicUrl', () => {
    const original = process.env.CONTROL_PLANE_PUBLIC_URL;

    afterEach(() => {
        if (original == null) delete process.env.CONTROL_PLANE_PUBLIC_URL;
        else process.env.CONTROL_PLANE_PUBLIC_URL = original;
    });

    it('defaults to localhost control plane', () => {
        delete process.env.CONTROL_PLANE_PUBLIC_URL;
        assert.equal(resolveControlPlanePublicUrlSync(), 'http://127.0.0.1:3000');
        assert.equal(resolveLlmPublicRouterBaseSync(), 'http://127.0.0.1:3000/api/v1/llm');
    });

    it('honors CONTROL_PLANE_PUBLIC_URL without trailing slash', () => {
        process.env.CONTROL_PLANE_PUBLIC_URL = 'https://app.example.com/';
        assert.equal(resolveControlPlanePublicUrlSync(), 'https://app.example.com');
        assert.equal(resolveLlmPublicRouterBaseSync(), 'https://app.example.com/api/v1/llm');
    });
});
