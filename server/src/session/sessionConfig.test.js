const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveAgentSpawnArgs, getAgentConfigSchema } = require('./sessionConfig');

test('resolveAgentSpawnArgs: droid extracts --model from first customModel', () => {
    const configFiles = [{
        path: '${STATE_DIR}/.factory/settings.json',
        content: JSON.stringify({
            customModels: [
                { provider: 'generic-chat-completion-api', model: 'deepseek-chat', baseUrl: 'https://x', apiKey: 'y' },
            ],
        }),
    }];
    assert.deepEqual(resolveAgentSpawnArgs('droid', configFiles), ['--model', 'deepseek-chat']);
});

test('resolveAgentSpawnArgs: droid returns [] when no customModels', () => {
    const configFiles = [{ path: '${STATE_DIR}/.factory/settings.json', content: '{}' }];
    assert.deepEqual(resolveAgentSpawnArgs('droid', configFiles), []);
});

test('resolveAgentSpawnArgs: droid returns [] on invalid json (no throw)', () => {
    const configFiles = [{ path: '${STATE_DIR}/.factory/settings.json', content: 'not-json' }];
    assert.deepEqual(resolveAgentSpawnArgs('droid', configFiles), []);
});

test('resolveAgentSpawnArgs: non-droid agents are unaffected', () => {
    const configFiles = [{ path: '${STATE_DIR}/.factory/settings.json', content: '{"customModels":[{"model":"x"}]}' }];
    assert.deepEqual(resolveAgentSpawnArgs('kimi-code', configFiles), []);
    assert.deepEqual(resolveAgentSpawnArgs('claude-code', configFiles), []);
});

test('resolveAgentSpawnArgs: empty configFiles returns []', () => {
    assert.deepEqual(resolveAgentSpawnArgs('droid', []), []);
    assert.deepEqual(resolveAgentSpawnArgs('droid', null), []);
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
