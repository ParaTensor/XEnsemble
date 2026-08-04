const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildGatewayConfigSpec, GATEWAY_CONFIG_AGENTS } = require('./ensureGatewayConfig');

const ctx = {
    stateDirPath: '/workspace/.xensemble/state/sess_test',
    sessionToken: 'xel_test_token',
    routerUrl: 'https://xensemble.dev/api/v1/llm',
    modelTarget: 'zxs_deepseek/deepseek-v4-flash',
};

test('glm-agent is in GATEWAY_CONFIG_AGENTS', () => {
    assert.ok(GATEWAY_CONFIG_AGENTS.has('glm-agent'), 'glm-agent must be in GATEWAY_CONFIG_AGENTS');
});

test('buildGatewayConfigSpec: glm-agent writes user-settings.json with gateway credentials', () => {
    const spec = buildGatewayConfigSpec('glm-agent', ctx);
    assert.ok(spec, 'spec must not be null for glm-agent');
    assert.equal(spec.filePath, '/workspace/.xensemble/state/sess_test/.zai/user-settings.json');
    assert.equal(spec.dirPath, '/workspace/.xensemble/state/sess_test/.zai');

    const content = JSON.parse(spec.content);
    assert.equal(content.baseURL, 'https://xensemble.dev/api/v1/llm/v1');
    assert.equal(content.apiKey, 'xel_test_token');
    assert.equal(content.defaultModel, 'zxs_deepseek/deepseek-v4-flash');
    assert.deepEqual(content.models, ['zxs_deepseek/deepseek-v4-flash']);
    assert.equal(content.watchEnabled, false);
    assert.equal(content.enableHistory, true);
});

test('buildGatewayConfigSpec: glm-agent uses routerUrl/v1 for baseURL', () => {
    const spec = buildGatewayConfigSpec('glm-agent', { ...ctx, routerUrl: 'https://custom.example.com/api/v1/llm' });
    const content = JSON.parse(spec.content);
    assert.equal(content.baseURL, 'https://custom.example.com/api/v1/llm/v1');
});

test('buildGatewayConfigSpec: glm-agent uses modelTarget for defaultModel and models', () => {
    const spec = buildGatewayConfigSpec('glm-agent', { ...ctx, modelTarget: 'zai/glm-4.6' });
    const content = JSON.parse(spec.content);
    assert.equal(content.defaultModel, 'zai/glm-4.6');
    assert.deepEqual(content.models, ['zai/glm-4.6']);
});

test('buildGatewayConfigSpec: unknown agent returns null', () => {
    assert.equal(buildGatewayConfigSpec('unknown-agent', ctx), null);
});

test('buildGatewayConfigSpec: cline still works (regression check)', () => {
    const spec = buildGatewayConfigSpec('cline', ctx);
    assert.ok(spec, 'cline spec must not be null');
    assert.equal(spec.filePath, '/workspace/.xensemble/state/sess_test/settings/providers.json');
    const content = JSON.parse(spec.content);
    assert.equal(content.providers['openai-compatible'].settings.apiKey, 'xel_test_token');
});

test('codebuddy is in GATEWAY_CONFIG_AGENTS', () => {
    assert.ok(GATEWAY_CONFIG_AGENTS.has('codebuddy'), 'codebuddy must be in GATEWAY_CONFIG_AGENTS');
});

test('buildGatewayConfigSpec: codebuddy writes models.json to CODEBUDDY_CONFIG_DIR (state dir)', () => {
    const spec = buildGatewayConfigSpec('codebuddy', ctx);
    assert.ok(spec, 'codebuddy spec must not be null');
    // CodeBuddy reads models.json from $CODEBUDDY_CONFIG_DIR (set to the
    // session state dir by resumeSession via stateEnv), not ~/.codebuddy.
    assert.equal(spec.filePath, '/workspace/.xensemble/state/sess_test/models.json');
    assert.equal(spec.dirPath, '/workspace/.xensemble/state/sess_test');

    const models = JSON.parse(spec.content);
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'zxs_deepseek/deepseek-v4-flash');
    assert.equal(models[0].apiKey, 'xel_test_token');
    assert.equal(models[0].url, 'https://xensemble.dev/api/v1/llm/v1/chat/completions');
    assert.equal(models[0].vendor, 'custom');

    // trust settings to skip the interactive folder-trust prompt
    assert.equal(spec.extraFiles.length, 1);
    assert.equal(spec.extraFiles[0].filePath, '/workspace/.xensemble/state/sess_test/settings.json');
    const settings = JSON.parse(spec.extraFiles[0].content);
    assert.equal(settings.trustAll, true);
    assert.deepEqual(settings.trustedDirectories, ['/workspace', '/tmp']);
});

test('buildGatewayConfigSpec: codebuddy falls back to $HOME/.codebuddy without a state dir', () => {
    const spec = buildGatewayConfigSpec('codebuddy', { ...ctx, stateDirPath: null });
    assert.ok(spec, 'codebuddy spec must not be null');
    assert.equal(spec.filePath, '$HOME/.codebuddy/models.json');
    assert.equal(spec.dirPath, '$HOME/.codebuddy');
    assert.equal(spec.extraFiles[0].filePath, '$HOME/.codebuddy/settings.json');
});
