const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    agentImageEnvKey,
    resolveAgentBoxImageDefault,
    resolveBoxBaseImage,
    resolveBoxImage,
    listBuildableAgentImages,
} = require('./agentBoxImages');

test('resolveBoxImage prefers explicit image, then env, then default naming', async () => {
    assert.equal(await resolveBoxImage({ image: 'custom:1' }), 'custom:1');
    assert.match(await resolveBoxImage({ agentId: 'claude-code' }), /agent-claude-code/);
    assert.match(await resolveBoxImage({}), /box-base/);
});

test('resolveAgentBoxImageDefault honors per-agent env override at resolve time', async () => {
    const key = agentImageEnvKey('droid');
    const prev = process.env[key];
    process.env[key] = 'registry.example/droid:prod';
    try {
        assert.equal(await resolveBoxImage({ agentId: 'droid' }), 'registry.example/droid:prod');
    } finally {
        if (prev === undefined) delete process.env[key];
        else process.env[key] = prev;
    }
});

test('resolveBoxBaseImage falls back to BLINK_IMAGE then default base', () => {
    const prevBase = process.env.BLINK_BASE_IMAGE;
    const prevBlink = process.env.BLINK_IMAGE;
    delete process.env.BLINK_BASE_IMAGE;
    delete process.env.BLINK_IMAGE;
    try {
        assert.match(resolveBoxBaseImage(), /box-base/);
        process.env.BLINK_IMAGE = 'legacy:1';
        assert.equal(resolveBoxBaseImage(), 'legacy:1');
        process.env.BLINK_BASE_IMAGE = 'base:2';
        assert.equal(resolveBoxBaseImage(), 'base:2');
    } finally {
        if (prevBase === undefined) delete process.env.BLINK_BASE_IMAGE;
        else process.env.BLINK_BASE_IMAGE = prevBase;
        if (prevBlink === undefined) delete process.env.BLINK_IMAGE;
        else process.env.BLINK_IMAGE = prevBlink;
    }
});

test('listBuildableAgentImages includes npm-backed agents and skips unsupported ones', () => {
    const entries = listBuildableAgentImages();
    const byId = new Map(entries.map((entry) => [entry.agentId, entry]));
    assert.ok(byId.has('claude-code'));
    assert.ok(byId.has('droid'));
    assert.equal(byId.has('cursor'), false);
    assert.match(byId.get('claude-code').install, /npm install -g/);
    assert.match(resolveAgentBoxImageDefault('claude-code'), /agent-claude-code/);
});
