const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { eq } = require('drizzle-orm');
const { bootstrapTestDb } = require('../test/db');

let ctx;
let db;
let schema;
let service;
let resolveBoxImage;

before(async () => {
    ctx = await bootstrapTestDb([
        '../db/index',
        '../runtime/AgentBoxImageService',
        '../runtime/agentBoxImages',
    ], __dirname);
    ({ db, schema } = ctx);
    service = ctx.reloaded['../runtime/AgentBoxImageService'];
    ({ resolveBoxImage } = ctx.reloaded['../runtime/agentBoxImages']);

    await db.insert(schema.users).values({
        id: 'admin',
        username: 'admin',
        passwordHash: 'hash',
        createdAt: 1,
    }).onConflictDoNothing();
    await db.insert(schema.agents).values({
        id: 'claude-code',
        name: 'Claude Code',
        cmd: 'claude',
        args: '[]',
        envRequired: '[]',
    }).onConflictDoNothing();
});

after(async () => {
    if (ctx) await ctx.teardown();
});

test('register, activate, and resolve active boxlite image from DB', async () => {
    const first = await service.registerVersion({
        agentId: 'claude-code',
        tag: 'v1',
        imageRef: 'registry.example/agent-claude-code:v1',
        createdBy: 'admin',
        setActive: true,
    });
    assert.equal(first.is_active, true);

    const second = await service.registerVersion({
        agentId: 'claude-code',
        tag: 'v2',
        imageRef: 'registry.example/agent-claude-code:v2',
        createdBy: 'admin',
        setActive: false,
    });
    assert.equal(second.is_active, false);

    await service.activateVersion(second.id, 'admin');
    assert.equal(await service.getActiveImageRef('claude-code'), 'registry.example/agent-claude-code:v2');

    const resolved = await resolveBoxImage({ agentId: 'claude-code' });
    assert.equal(resolved, 'registry.example/agent-claude-code:v2');

    const catalog = await service.listAgentBoxImageCatalog();
    const entry = catalog.find((row) => row.agent_id === 'claude-code');
    assert.equal(entry.active_version.tag, 'v2');
    assert.equal(entry.versions.length, 2);
});

test('registerVersion rejects invalid image_ref without touching shared database', async () => {
    await assert.rejects(
        () => service.registerVersion({
            agentId: 'claude-code',
            tag: 'bad-ref',
            imageRef: 'registry.example/agent claude-code:v1',
            createdBy: 'admin',
        }),
        /image_ref contains invalid characters/i,
    );
});
