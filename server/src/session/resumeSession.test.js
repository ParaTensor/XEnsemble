const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { eq } = require('drizzle-orm');

const { db } = require('../db/index');
const schema = require('../db/schema');
const sessionManager = require('./SessionManager');
const transcriptStore = require('../runtime/TranscriptStore');
const { resumeSession, registerSessionLifecycle } = require('./resumeSession');

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'xe-resume-'));
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

function makeFakeHandle(cmd, args, env, cwd) {
    const child = spawn(cmd, args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    const dataListeners = new Set();
    const exitListeners = new Set();
    child.stdout.on('data', (chunk) => {
        const data = chunk.toString();
        for (const cb of [...dataListeners]) cb(data);
    });
    child.stderr.on('data', (chunk) => {
        const data = chunk.toString();
        for (const cb of [...dataListeners]) cb(data);
    });
    child.on('exit', (exitCode, signal) => {
        for (const cb of [...exitListeners]) cb({ exitCode, signal });
    });
    return {
        streamRef: `local:pty:${Date.now()}_${Math.random().toString(16).slice(2)}_${child.pid}`,
        onData(cb) {
            dataListeners.add(cb);
            return { dispose: () => dataListeners.delete(cb) };
        },
        onExit(cb) {
            exitListeners.add(cb);
            return () => exitListeners.delete(cb);
        },
        write(data) {
            child.stdin.write(data);
        },
        resize() {},
        kill() {
            child.kill('SIGTERM');
        },
        get pid() {
            return child.pid;
        },
        async getMetrics() {
            return { cpu: 0, memory: 0 };
        },
    };
}

function waitForExit(sessionId) {
    return new Promise((resolve) => {
        const off = sessionManager.onExit(sessionId, () => {
            off();
            resolve();
        });
    });
}

test('resumeSession reuses state dir and continues transcript seqs', async () => {
    const root = makeTempDir();
    const projectDir = path.join(root, 'project');
    const stateEnv = 'CLAUDE_CONFIG_DIR';
    const sessionId = `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const userId = `usr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const projectId = `proj_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const stateDirRef = path.join('.xensemble', 'state', sessionId);
    const stateDirPath = path.join(projectDir, stateDirRef);
    const scriptPath = path.join(root, 'fake-agent.js');
    const markerPath = path.join(stateDirPath, 'resume-marker.txt');

    fs.mkdirSync(stateDirPath, { recursive: true });
    fs.writeFileSync(scriptPath, `
        const fs = require('fs');
        const path = require('path');
        const stateDir = process.env.${stateEnv};
        const marker = path.join(stateDir, 'resume-marker.txt');
        const isResume = process.argv.includes('--continue');
        if (!isResume) {
            fs.writeFileSync(marker, 'seed');
            process.stdout.write('started:seed\\n');
        } else {
            const markerValue = fs.readFileSync(marker, 'utf8').trim();
            process.stdout.write(\`resumed:\${markerValue}\\n\`);
        }
        setTimeout(() => process.exit(0), 50);
    `);

    try {
        const now = Date.now();
        await db.insert(schema.users).values({
            id: userId,
            username: `resume_${now}`,
            passwordHash: 'hash',
            role: 'user',
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        await db.insert(schema.projects).values({
            id: projectId,
            userId,
            name: 'Resume Project',
            serverPath: projectDir,
            createdAt: now,
        });
        await db.insert(schema.sessions).values({
            id: sessionId,
            userId,
            projectId,
            agentId: 'claude-code',
            cwd: projectDir,
            streamRef: null,
            stateDirRef,
            recoverable: true,
            status: 'running',
            createdAt: now,
        });

        const firstHandle = makeFakeHandle(
            process.execPath,
            [scriptPath],
            { ...process.env, [stateEnv]: stateDirPath },
            projectDir,
        );
        firstHandle.transcriptRef = firstHandle.streamRef;
        sessionManager.createSession(sessionId, firstHandle, 'claude-code', { transcriptRef: firstHandle.streamRef });
        await registerSessionLifecycle({
            db,
            schema,
            sessionManager,
            sessionId,
            project: { id: projectId, workspaceMode: 'local' },
            fastifyLog: { error() {} },
        });

        await db.update(schema.sessions).set({
            streamRef: firstHandle.streamRef,
            stateDirRef,
            recoverable: true,
        }).where(eq(schema.sessions.id, sessionId));

        await waitForExit(sessionId);
        await new Promise((resolve) => setTimeout(resolve, 50));

        const resumedRow = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
        assert.equal(resumedRow[0].status, 'exited');
        assert.equal(resumedRow[0].recoverable, true);
        assert.equal(resumedRow[0].stateDirRef, stateDirRef);

        const transcriptAfterFirstRun = transcriptStore.readFrom(firstHandle.streamRef, 0);
        assert.deepEqual(transcriptAfterFirstRun.map((frame) => frame.seq), [1, 2]);
        assert.equal(transcriptAfterFirstRun[0].data, 'started:seed\n');

        const project = {
            id: projectId,
            userId,
            serverPath: projectDir,
            repoProvider: 'none',
            repoDefaultBranch: 'main',
            currentBranch: '',
            githubFullName: '',
            workspaceMode: 'local',
        };
        const session = resumedRow[0];
        const agentMeta = {
            id: 'claude-code',
            name: 'Claude Code',
            cmd: process.execPath,
            args: [scriptPath],
            env_required: [],
        };
        const runtime = {
            exec: {
                async spawn(cmd, args, env, options) {
                    return makeFakeHandle(cmd, args, env, options.cwd);
                },
            },
        };

        const result = await resumeSession({
            db,
            schema,
            sessionManager,
            runtime,
            project,
            session,
            agentMeta,
            terminalThemeId: null,
            resolvedSpawnEnv: { env: {}, spawn_env_preview: {} },
            requestLog: { warn() {}, error() {} },
            fastifyLog: { error() {} },
            ensureProjectRuntime: async () => ({
                runtime: { id: 'rt_fake', runtimeRef: 'rt_fake_ref' },
                workspacePath: projectDir,
            }),
            issueSessionToken: () => null,
            agentGatewayConfig: {
                async getAgentAuthMode() { return 'byok'; },
                async getForAgent() { return null; },
            },
            requestUser: { id: userId, role: 'user' },
        });
        assert.equal(result.status, 'running');
        assert.equal(result.state_dir_ref, stateDirRef);

        await waitForExit(sessionId);
        await new Promise((resolve) => setTimeout(resolve, 50));

        const streamRows = await db.select().from(schema.sessionStreams).where(eq(schema.sessionStreams.sessionId, sessionId));
        assert.equal(streamRows.length, 1);
        assert.equal(streamRows[0].storageRef, firstHandle.streamRef);
        assert.equal(streamRows[0].headSeq, 4);

        const transcript = transcriptStore.readFrom(firstHandle.streamRef, 0);
        assert.deepEqual(transcript.map((frame) => frame.seq), [1, 2, 3, 4]);
        assert.equal(transcript[2].data, 'resumed:seed\n');
        assert.deepEqual(transcript.filter((frame) => frame.kind === 'out').map((frame) => frame.data), [
            'started:seed\n',
            'resumed:seed\n',
        ]);
        assert.equal(fs.readFileSync(markerPath, 'utf8'), 'seed');
    } finally {
        sessionManager.deleteSession(sessionId);
        await new Promise((resolve) => setImmediate(resolve));
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        cleanup(root);
    }
});

test('resumeSession rejects non-resumable sessions', async () => {
    const root = makeTempDir();
    const projectDir = path.join(root, 'project');
    const sessionId = `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const userId = `usr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const projectId = `proj_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    try {
        const now = Date.now();
        await db.insert(schema.users).values({
            id: userId,
            username: `resume_reject_${now}`,
            passwordHash: 'hash',
            role: 'user',
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        await db.insert(schema.projects).values({
            id: projectId,
            userId,
            name: 'Resume Reject Project',
            serverPath: projectDir,
            createdAt: now,
        });
        await db.insert(schema.sessions).values({
            id: sessionId,
            userId,
            projectId,
            agentId: 'kimi-code',
            cwd: projectDir,
            streamRef: null,
            stateDirRef: null,
            recoverable: false,
            status: 'exited',
            createdAt: now,
        });

        await assert.rejects(() => resumeSession({
            db,
            schema,
            sessionManager,
            runtime: { exec: { async spawn() { throw new Error('should not spawn'); } } },
            project: {
                id: projectId,
                userId,
                serverPath: projectDir,
                repoProvider: 'none',
                repoDefaultBranch: 'main',
                currentBranch: '',
                githubFullName: '',
                workspaceMode: 'local',
            },
            session: {
                id: sessionId,
                runtimeId: null,
                streamRef: null,
                stateDirRef: null,
                recoverable: false,
                status: 'exited',
                cwd: projectDir,
            },
            agentMeta: {
                id: 'kimi-code',
                name: 'Kimi Code',
                cmd: process.execPath,
                args: [],
                env_required: [],
            },
            terminalThemeId: null,
            resolvedSpawnEnv: { env: {}, spawn_env_preview: {} },
            requestLog: { warn() {}, error() {} },
            fastifyLog: { error() {} },
            ensureProjectRuntime: async () => ({
                runtime: { id: 'rt_fake', runtimeRef: 'rt_fake_ref' },
                workspacePath: projectDir,
            }),
            issueSessionToken: () => null,
            agentGatewayConfig: {
                async getAgentAuthMode() { return 'byok'; },
                async getForAgent() { return null; },
            },
            requestUser: { id: userId, role: 'user' },
        }), (err) => {
            assert.equal(err.statusCode, 409);
            assert.match(err.message, /session not resumable/i);
            return true;
        });
    } finally {
        sessionManager.deleteSession(sessionId);
        await new Promise((resolve) => setImmediate(resolve));
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        cleanup(root);
    }
});
