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

test('applyGatewayAgentEnv: github-copilot injects COPILOT_PROVIDER_* env', () => {
    const env = applyGatewayAgentEnv('github-copilot', {
        OPENAI_MODEL: 'zxs_deepseek/deepseek-v4-flash',
    }, {
        LLM_ROUTER_URL: 'https://xensemble.dev/api/v1/llm',
        LLM_ROUTER_API_KEY: 'xel_session_token',
    }, []);
    assert.equal(env.COPILOT_PROVIDER_BASE_URL, 'https://xensemble.dev/api/v1/llm/v1');
    assert.equal(env.COPILOT_PROVIDER_TYPE, 'openai');
    assert.equal(env.COPILOT_PROVIDER_API_KEY, 'xel_session_token');
    assert.equal(env.COPILOT_MODEL, 'zxs_deepseek/deepseek-v4-flash');
});

test('applyGatewayAgentEnv: github-copilot skips injection when gateway missing', () => {
    const env = applyGatewayAgentEnv('github-copilot', { OPENAI_MODEL: 'm' }, {}, []);
    assert.equal(env.COPILOT_PROVIDER_BASE_URL, undefined);
});

test('applyGatewayAgentEnv: codebuddy injects CODEBUDDY_API_KEY to skip login', () => {
    const env = applyGatewayAgentEnv('codebuddy', {}, {
        LLM_ROUTER_API_KEY: 'xel_session_token',
    }, []);
    assert.equal(env.CODEBUDDY_API_KEY, 'xel_session_token');
});

test('applyGatewayAgentEnv: codebuddy skips injection when no gateway key', () => {
    const env = applyGatewayAgentEnv('codebuddy', {}, {}, []);
    assert.equal(env.CODEBUDDY_API_KEY, undefined);
});
