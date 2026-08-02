const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const unigateway = require('./unigatewayManager');
const gatewaySettings = require('../admin/GatewaySettings');
const { resolveGatewayAdminTarget } = require('./adminProxy');

const originalEnsureRunning = unigateway.ensureRunning;
const originalEnsureGatewaySecrets = unigateway.ensureGatewaySecrets;
const originalGetConfig = gatewaySettings.getConfig;
const originalExternalUrl = process.env.LLM_GATEWAY_UPSTREAM_URL;
const originalAdminToken = process.env.UNIGATEWAY_ADMIN_TOKEN;

afterEach(() => {
    unigateway.ensureRunning = originalEnsureRunning;
    unigateway.ensureGatewaySecrets = originalEnsureGatewaySecrets;
    gatewaySettings.getConfig = originalGetConfig;
    if (originalExternalUrl == null) delete process.env.LLM_GATEWAY_UPSTREAM_URL;
    else process.env.LLM_GATEWAY_UPSTREAM_URL = originalExternalUrl;
    if (originalAdminToken == null) delete process.env.UNIGATEWAY_ADMIN_TOKEN;
    else process.env.UNIGATEWAY_ADMIN_TOKEN = originalAdminToken;
});

describe('resolveGatewayAdminTarget', () => {
    it('uses the external upstream for admin operations without starting a local gateway', async () => {
        process.env.LLM_GATEWAY_UPSTREAM_URL = 'https://gateway.example.test/';
        process.env.UNIGATEWAY_ADMIN_TOKEN = 'external-admin-token';
        let localStarts = 0;
        unigateway.ensureRunning = async () => {
            localStarts += 1;
            return { running: false };
        };
        unigateway.ensureGatewaySecrets = () => ({
            adminToken: 'local-admin-token',
            gatewayKey: 'local-gateway-key',
        });
        gatewaySettings.getConfig = async () => ({ upstream_url: '' });

        const target = await resolveGatewayAdminTarget();

        assert.equal(target.baseUrl, 'https://gateway.example.test');
        assert.equal(target.adminToken, 'external-admin-token');
        assert.equal(target.external, true);
        assert.equal(localStarts, 0);
    });

    it('falls back to the managed local gateway when no external upstream is configured', async () => {
        delete process.env.LLM_GATEWAY_UPSTREAM_URL;
        gatewaySettings.getConfig = async () => ({ upstream_url: '' });
        unigateway.ensureRunning = async () => ({
            running: true,
            baseUrl: 'http://127.0.0.1:8741',
            adminToken: 'local-admin-token',
        });

        const target = await resolveGatewayAdminTarget();

        assert.equal(target.baseUrl, 'http://127.0.0.1:8741');
        assert.equal(target.adminToken, 'local-admin-token');
        assert.equal(target.external, undefined);
    });
});
