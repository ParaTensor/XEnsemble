const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildKimiConfigToml } = require('./kimiConfigToml');

test('buildKimiConfigToml includes provider and default model', () => {
    const toml = buildKimiConfigToml({
        apiKey: 'sk-test',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.5',
    });
    assert.match(toml, /default_model = "kimi-k2\.5"/);
    assert.match(toml, /\[providers\.kimi\]/);
    assert.match(toml, /api_key = "sk-test"/);
    assert.match(toml, /base_url = "https:\/\/api\.moonshot\.cn\/v1"/);
});

test('buildKimiConfigToml escapes quotes in api key', () => {
    const toml = buildKimiConfigToml({
        apiKey: 'sk-"quote"',
        baseUrl: 'https://api.moonshot.cn/v1',
        model: 'kimi-k2.5',
    });
    assert.match(toml, /api_key = "sk-\\"quote\\""/);
});
