const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyGatewayAgentEnv } = require('./agentEnv');

test('applyGatewayAgentEnv: droid enables BYOK airgap mode', () => {
    const env = applyGatewayAgentEnv('droid', { LLM_ROUTER_URL: 'http://gw/v1' }, {}, []);
    assert.equal(env.FACTORY_AIRGAP_ENABLED, '1');
});

test('applyGatewayAgentEnv: non-droid agents are untouched', () => {
    const env = applyGatewayAgentEnv('qwen-code', { LLM_ROUTER_URL: 'http://gw/v1' }, {}, []);
    assert.equal(env.FACTORY_AIRGAP_ENABLED, undefined);
});
