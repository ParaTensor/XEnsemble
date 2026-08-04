const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyCustomEnv, resolveAgentSpawnArgs, getAgentConfigSchema } = require('./sessionConfig');

test('applyCustomEnv preserves gateway-managed values when overrides are blocked', () => {
    const result = applyCustomEnv(
        { ANTHROPIC_API_KEY: 'xel_session', ANTHROPIC_BASE_URL: 'https://control/llm' },
        { ANTHROPIC_API_KEY: 'sk-user', ANTHROPIC_BASE_URL: 'https://api.anthropic.com', CUSTOM_FLAG: 'on' },
        { blockedKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'] },
    );
    assert.deepEqual(result, {
        ANTHROPIC_API_KEY: 'xel_session',
        ANTHROPIC_BASE_URL: 'https://control/llm',
        CUSTOM_FLAG: 'on',
    });
});

test('resolveAgentSpawnArgs: droid extracts --model from first customModel (BYOK)', () => {
    const configFiles = [{
        path: '${STATE_DIR}/.factory/settings.json',
        content: JSON.stringify({
            customModels: [
                { provider: 'generic-chat-completion-api', model: 'deepseek-chat', baseUrl: 'https://x', apiKey: 'y' },
            ],
        }),
    }];
    const result = resolveAgentSpawnArgs('droid', configFiles);
    assert.deepEqual(result, { prepend: [], append: ['--model', 'deepseek-chat'] });
});

test('resolveAgentSpawnArgs: droid gateway mode uses gatewayModel', () => {
    const result = resolveAgentSpawnArgs('droid', [], { authMode: 'gateway', gatewayModel: 'deepseek/deepseek-chat' });
    assert.deepEqual(result, { prepend: [], append: ['--model', 'deepseek/deepseek-chat'] });
});

test('resolveAgentSpawnArgs: droid returns empty when no customModels (BYOK)', () => {
    const configFiles = [{ path: '${STATE_DIR}/.factory/settings.json', content: '{}' }];
    assert.deepEqual(resolveAgentSpawnArgs('droid', configFiles), { prepend: [], append: [] });
});

test('resolveAgentSpawnArgs: droid returns empty on invalid json (no throw)', () => {
    const configFiles = [{ path: '${STATE_DIR}/.factory/settings.json', content: 'not-json' }];
    assert.deepEqual(resolveAgentSpawnArgs('droid', configFiles), { prepend: [], append: [] });
});

test('resolveAgentSpawnArgs: hermes gateway mode prepends -m', () => {
    const result = resolveAgentSpawnArgs('hermes', [], { authMode: 'gateway', gatewayModel: 'zxs_deepseek/deepseek-v4-flash' });
    assert.deepEqual(result, { prepend: ['-m', 'zxs_deepseek/deepseek-v4-flash'], append: [] });
});

test('resolveAgentSpawnArgs: hermes BYOK mode does not prepend -m', () => {
    const result = resolveAgentSpawnArgs('hermes', [], { authMode: 'byok' });
    assert.deepEqual(result, { prepend: [], append: [] });
});

test('resolveAgentSpawnArgs: cline gateway mode prepends -P openai-compatible', () => {
    const result = resolveAgentSpawnArgs('cline', [], { authMode: 'gateway', gatewayModel: 'zxs_deepseek/deepseek-v4-flash' });
    assert.deepEqual(result, { prepend: ['-P', 'openai-compatible', '-m', 'zxs_deepseek/deepseek-v4-flash'], append: [] });
});

test('resolveAgentSpawnArgs: cline BYOK mode does not prepend -P', () => {
    const result = resolveAgentSpawnArgs('cline', [], { authMode: 'byok' });
    assert.deepEqual(result, { prepend: [], append: [] });
});

test('resolveAgentSpawnArgs: non-droid/hermes/cline agents are unaffected', () => {
    const configFiles = [{ path: '${STATE_DIR}/.factory/settings.json', content: '{"customModels":[{"model":"x"}]}' }];
    assert.deepEqual(resolveAgentSpawnArgs('kimi-code', configFiles), { prepend: [], append: [] });
    assert.deepEqual(resolveAgentSpawnArgs('claude-code', configFiles), { prepend: [], append: [] });
});

test('resolveAgentSpawnArgs: empty configFiles returns empty', () => {
    assert.deepEqual(resolveAgentSpawnArgs('droid', []), { prepend: [], append: [] });
    assert.deepEqual(resolveAgentSpawnArgs('droid', null), { prepend: [], append: [] });
});

test('droid agent catalog exposes a configSchema with .factory/settings.json', () => {
    const schema = getAgentConfigSchema('droid');
    assert.ok(schema, 'droid should have a configSchema');
    assert.ok(schema.configFiles?.length, 'droid should have configFiles');
    const file = schema.configFiles.find((f) => f.path.endsWith('.factory/settings.json'));
    assert.ok(file, 'should declare .factory/settings.json');
    assert.equal(file.format, 'json');
    assert.ok(file.example, 'should provide an example');
    assert.doesNotThrow(() => JSON.parse(file.example), 'example should be valid JSON');
});
