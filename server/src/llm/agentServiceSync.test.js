const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    hasServiceBlock,
    hasBinding,
    appendAgentService,
} = require('./agentServiceToml');

const TOML_WITH_SERVICE = `
[[services]]
id = "default"
name = "Default"
routing_strategy = "round_robin"

[[services]]
id = "kimi-code"
name = "kimi-code"
routing_strategy = "round_robin"

[[bindings]]
service_id = "kimi-code"
provider_name = "deepseek-main"
priority = 0
`;

test('hasServiceBlock matches an existing service id', () => {
    assert.equal(hasServiceBlock(TOML_WITH_SERVICE, 'kimi-code'), true);
});

test('hasServiceBlock does not match a missing service id', () => {
    assert.equal(hasServiceBlock(TOML_WITH_SERVICE, 'qwen-code'), false);
});

test('hasServiceBlock does not match a substring of a service id', () => {
    assert.equal(hasServiceBlock(TOML_WITH_SERVICE, 'code'), false);
});

test('hasBinding matches an existing service/provider binding', () => {
    assert.equal(hasBinding(TOML_WITH_SERVICE, 'kimi-code', 'deepseek-main'), true);
});

test('hasBinding does not match when provider differs', () => {
    assert.equal(hasBinding(TOML_WITH_SERVICE, 'kimi-code', 'qwen-main'), false);
});

test('appendAgentService adds service block and binding for a new agent', () => {
    const before = `preferences.default_mode = "default"
`;
    const after = appendAgentService(before, 'qwen-code', 'deepseek-main');
    assert.equal(hasServiceBlock(after, 'qwen-code'), true);
    assert.equal(hasBinding(after, 'qwen-code', 'deepseek-main'), true);
});

test('appendAgentService only adds binding when service already exists', () => {
    const after = appendAgentService(TOML_WITH_SERVICE, 'kimi-code', 'qwen-main');
    assert.equal(hasBinding(after, 'kimi-code', 'qwen-main'), true);
    // Existing [[services]] block must not be duplicated.
    assert.equal(after.match(/\[\[services\]\]\nid = "kimi-code"/g).length, 1);
});

test('appendAgentService is idempotent for an existing binding', () => {
    const after = appendAgentService(TOML_WITH_SERVICE, 'kimi-code', 'deepseek-main');
    assert.equal(after, TOML_WITH_SERVICE);
});

test('appendAgentService escapes quotes in agent id', () => {
    const after = appendAgentService('', 'weird"id', 'p');
    assert.equal(hasServiceBlock(after, 'weird"id'), false);
    assert.ok(after.includes('id = "weirdid"'));
});
