const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    seedAgentWorkspaceFiles,
    shouldRunSetup,
    ensureAgentBootstrap,
    readSetupStatus,
} = require('./agentBootstrap');
const { bootstrapTestDb } = require('../test/db');

describe('agentBootstrap', () => {
    let tmpDir;
    let ctx;

    before(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xensemble-bootstrap-'));
        ctx = await bootstrapTestDb([], __dirname);
    });

    after(async () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        await ctx.teardown();
    });

    it('seeds setup script, AGENTS.md, and preview contract', () => {
        const ws = path.join(tmpDir, 'seed');
        fs.mkdirSync(ws, { recursive: true });
        seedAgentWorkspaceFiles(ws);
        assert.ok(fs.existsSync(path.join(ws, '.agents', 'setup')));
        assert.ok(fs.existsSync(path.join(ws, '.agents', 'AGENTS.md')));
        assert.ok(fs.existsSync(path.join(ws, '.agents', 'preview.json')));
        assert.ok(fs.existsSync(path.join(ws, 'index.html')));
    });

    it('runs setup once and skips when hash unchanged', async () => {
        const projectId = `proj_${Date.now()}`;
        const userId = `usr_${Date.now()}`;
        const schema = require('../db/schema');
        await ctx.db.insert(schema.users).values({
            id: userId,
            username: `bootstrap_${Date.now()}`,
            passwordHash: 'hash',
            role: 'admin',
            status: 'active',
            createdAt: Date.now(),
        });
        await ctx.db.insert(schema.projects).values({
            id: projectId,
            userId,
            name: 'bootstrap test',
            serverPath: '',
            createdAt: Date.now(),
        });
        const project = { id: projectId, userId };
        const ws = path.join(tmpDir, 'ws1');
        fs.mkdirSync(ws, { recursive: true });
        seedAgentWorkspaceFiles(ws);

        const first = await ensureAgentBootstrap(project, ws);
        assert.equal(first.status, 'completed');
        assert.ok(first.snapshot_id);

        assert.equal(shouldRunSetup(ws), false);
        const second = await ensureAgentBootstrap(project, ws);
        assert.equal(readSetupStatus(ws).snapshot_id, first.snapshot_id);
        assert.equal(second.snapshot_id, first.snapshot_id);
    });
});
