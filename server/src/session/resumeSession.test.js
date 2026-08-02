const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { eq } = require('drizzle-orm');

const LocalFsAdapter = require('../runtime/LocalFsAdapter');
const localFs = new LocalFsAdapter();
const { bootstrapTestDb } = require('../test/db');

let ctx;
let db;
let schema;
let sessionManager;
let transcriptStore;
let resumeSession;
let registerSessionLifecycle;
const { buildSessionStateDirRef } = require('./stateDirRef');

before(async () => {
    ctx = await bootstrapTestDb([
        '../db/index',
        '../runtime/TranscriptStore',
        './SessionManager',
        './resumeSession',
    ], __dirname);
    ({ db, schema } = ctx);
    sessionManager = ctx.reloaded['./SessionManager'];
    transcriptStore = ctx.reloaded['../runtime/TranscriptStore'];
    ({ resumeSession, registerSessionLifecycle } = ctx.reloaded['./resumeSession']);
});

after(async () => {
    if (ctx) await ctx.teardown();
});

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

function makeMemoryHandle(streamRef) {
    const dataListeners = new Set();
    const exitListeners = new Set();
    return {
        streamRef,
        onData(cb) {
            dataListeners.add(cb);
            return { dispose: () => dataListeners.delete(cb) };
        },
        onExit(cb) {
            exitListeners.add(cb);
            return { dispose: () => exitListeners.delete(cb) };
        },
        write() {},
        resize() {},
        kill() {},
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
    const stateDirRef = buildSessionStateDirRef(sessionId);
    const { stateDirPath } = localFs.resolveStateDir(projectDir, sessionId);
    const scriptPath = path.join(root, 'fake-agent.js');
    const markerPath = path.join(stateDirPath, 'resume-marker.txt');

    fs.mkdirSync(stateDirPath, { recursive: true });
    // Create sessions/ subdirectory with a dummy file so that hasResumeData
    // (resumeCheckSubdir: 'sessions' for claude-code) returns true.
    fs.mkdirSync(path.join(stateDirPath, 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(stateDirPath, 'sessions', 'dummy.json'), '{}');
    fs.mkdirSync(projectDir, { recursive: true });
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
            fs: localFs,
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
        try {
            await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
            await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
            await db.delete(schema.users).where(eq(schema.users.id, userId));
        } catch (_) {
        }
        cleanup(root);
    }
});

test('resumeSession reattaches a live execution from the persisted transcript cursor', async () => {
    const root = makeTempDir();
    const projectDir = path.join(root, 'project');
    const sessionId = `sess_reattach_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const userId = `usr_reattach_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const projectId = `proj_reattach_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const stateDirRef = buildSessionStateDirRef(sessionId);
    const { stateDirPath } = localFs.resolveStateDir(projectDir, sessionId);
    const streamRef = `boxlite:p_${projectId}:exec_1`;
    const now = Date.now();

    fs.mkdirSync(stateDirPath, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    try {
        await db.insert(schema.users).values({
            id: userId,
            username: `reattach_${now}`,
            passwordHash: 'hash',
            role: 'user',
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        await db.insert(schema.projects).values({
            id: projectId,
            userId,
            name: 'Reattach Project',
            serverPath: projectDir,
            createdAt: now,
        });
        await db.insert(schema.sessions).values({
            id: sessionId,
            userId,
            projectId,
            agentId: 'kimi-code',
            cwd: projectDir,
            streamRef,
            stateDirRef,
            recoverable: true,
            status: 'idle',
            createdAt: now,
        });

        transcriptStore.bindSession(sessionId, streamRef);
        transcriptStore.append(streamRef, { kind: 'out', data: 'before disconnect\n', rseq: 2 });

        let observedAfter = null;
        const handle = makeMemoryHandle(streamRef);
        const runtime = {
            fs: localFs,
            exec: {
                async exec() {
                    return { exitCode: 0, stdout: '', stderr: '' };
                },
                async spawn() {
                    throw new Error('reattach should avoid spawning a replacement process');
                },
            },
            provider: {
                async attachSession(id, ref, options) {
                    assert.equal(id, sessionId);
                    assert.equal(ref, streamRef);
                    observedAfter = options.after;
                    return handle;
                },
            },
        };

        const result = await resumeSession({
            db,
            schema,
            sessionManager,
            runtime,
            project: {
                id: projectId,
                userId,
                serverPath: projectDir,
                repoProvider: 'none',
                workspaceMode: 'local',
            },
            session: (await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)))[0],
            agentMeta: {
                id: 'kimi-code',
                name: 'Kimi Code',
                cmd: 'kimi',
                args: [],
                env_required: [],
            },
            terminalThemeId: null,
            resolvedSpawnEnv: { env: {}, spawn_env_preview: {} },
            requestLog: { warn() {}, error() {} },
            fastifyLog: { warn() {}, error() {} },
            ensureProjectRuntime: async () => ({
                runtime: { id: 'rt_reattach', runtimeRef: 'runtime_ref_reattach' },
                workspacePath: projectDir,
            }),
            issueSessionToken: () => null,
            agentGatewayConfig: {
                async getAgentAuthMode() { return 'byok'; },
                async getForAgent() { return null; },
            },
            requestUser: { id: userId, role: 'user' },
        });

        assert.equal(result.reattached, true);
        assert.equal(result.status, 'running');
        assert.equal(observedAfter, 2);
        assert.equal(sessionManager.isAlive(sessionId), true);
    } finally {
        sessionManager.deleteSession(sessionId);
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.runtimes).where(eq(schema.runtimes.projectId, projectId));
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

        try {
            await resumeSession({
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
            });
            assert.fail('Should have rejected');
        } catch (err) {
            assert.equal(err.statusCode, 409);
            assert.match(err.message, /session not resumable/i);
        }
    } finally {
        sessionManager.deleteSession(sessionId);
        await new Promise((resolve) => setImmediate(resolve));
        await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
        await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        cleanup(root);
    }
});
