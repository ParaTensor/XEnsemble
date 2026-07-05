const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    seedResumeScript,
    shouldRunResume,
    ensureAgentResume,
    readResumeStatus,
} = require('./agentResumeHook');
const { seedAgentWorkspaceFiles } = require('./agentBootstrap');

describe('agentResumeHook', () => {
    let tmpDir;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xensemble-resume-'));
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('seeds resume script with workspace files', () => {
        const ws = path.join(tmpDir, 'seed');
        fs.mkdirSync(ws, { recursive: true });
        seedAgentWorkspaceFiles(ws);
        assert.ok(fs.existsSync(path.join(ws, '.agents', 'resume')));
        const agentsMd = fs.readFileSync(path.join(ws, '.agents', 'AGENTS.md'), 'utf8');
        assert.match(agentsMd, /xensemble-agents-md v2/);
        assert.match(agentsMd, /\.agents\/resume/);
    });

    it('runs resume on wake and skips when unchanged', async () => {
        const ws = path.join(tmpDir, 'wake');
        fs.mkdirSync(ws, { recursive: true });
        seedAgentWorkspaceFiles(ws);
        const project = { id: 'proj_resume', userId: 'usr_resume' };

        const first = await ensureAgentResume(project, ws, { onWake: true, ensurePreview: false });
        assert.equal(first.status, 'completed');

        assert.equal(shouldRunResume(ws), false);
        const second = await ensureAgentResume(project, ws, { ensurePreview: false });
        assert.equal(readResumeStatus(ws).finished_at, second.finished_at);
    });

    it('force re-runs resume script', async () => {
        const ws = path.join(tmpDir, 'force');
        fs.mkdirSync(ws, { recursive: true });
        seedAgentWorkspaceFiles(ws);
        const project = { id: 'proj_force', userId: 'usr_force' };

        await ensureAgentResume(project, ws, { onWake: true, ensurePreview: false });
        assert.equal(shouldRunResume(ws), false);
        assert.equal(shouldRunResume(ws, { force: true }), true);
    });
});
