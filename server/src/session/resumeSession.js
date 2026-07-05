const { eq } = require('drizzle-orm');
const { sessionStateDirExists } = require('./stateDir');
const { getAgentResume, getAgentResumeLevel } = require('../agents/agentResume');

const inFlightResumes = new Map();

function withResumeLock(sessionId, fn) {
    const existing = inFlightResumes.get(sessionId);
    if (existing) return existing;
    const pending = Promise.resolve().then(fn).finally(() => {
        if (inFlightResumes.get(sessionId) === pending) {
            inFlightResumes.delete(sessionId);
        }
    });
    inFlightResumes.set(sessionId, pending);
    return pending;
}

async function registerSessionLifecycle({
    db,
    schema,
    sessionManager,
    sessionId,
    project,
    fastifyLog,
}) {
    sessionManager.onExit(sessionId, () => {
        db.update(schema.sessions)
            .set({ status: 'exited' })
            .where(eq(schema.sessions.id, sessionId))
            .catch((err) => fastifyLog.error(err, 'Failed to persist session exit status'));

        if (project && project.workspaceMode === 'git') {
            const { GitOperationService } = require('../github/GitOperationService');
            const gitOps = new GitOperationService({ getToken: () => null });
            gitOps.commitAll(project, `chore(xensemble): auto-checkpoint session ${sessionId}`)
                .catch(() => { /* best-effort: ignore if nothing to commit or workspace missing */ });
        }
    });
}

async function resumeSession({
    db,
    schema,
    sessionManager,
    runtime,
    project,
    session,
    agentMeta,
    terminalThemeId,
    resolvedSpawnEnv,
    requestLog,
    fastifyLog,
    ensureProjectRuntime,
    issueSessionToken,
    agentGatewayConfig,
    requestUser,
}) {
    return withResumeLock(session.id, async () => {
        const existingLive = sessionManager.getSession(session.id);
        if (existingLive && sessionManager.isAlive(session.id)) {
            return {
                session_id: session.id,
                status: 'running',
                runtime_id: session.runtimeId || null,
                stream_ref: existingLive.streamRef || null,
                recoverable: Boolean(session.recoverable),
                terminal_theme_id: terminalThemeId || null,
                spawn_env_preview: resolvedSpawnEnv?.spawn_env_preview || null,
                state_dir_ref: session.stateDirRef || null,
            };
        }

        const resumeSpec = getAgentResume(agentMeta.id);
        if (getAgentResumeLevel(agentMeta.id) !== 'L2' || !resumeSpec?.stateEnv || !session.stateDirRef || !session.recoverable) {
            const error = new Error('session not resumable — please start a new session');
            error.statusCode = 409;
            throw error;
        }

        const transcriptRows = await db.select().from(schema.sessionStreams)
            .where(eq(schema.sessionStreams.sessionId, session.id));
        const transcriptRef = transcriptRows[0]?.storageRef || session.streamRef || null;
        if (!transcriptRef) {
            const error = new Error('session not resumable — please start a new session');
            error.statusCode = 409;
            throw error;
        }

        const runtimeReady = await ensureProjectRuntime(project, {
            runtimeId: session.runtimeId || undefined,
            agentId: session.agentId || agentMeta.id,
        });

        const workspacePath = runtimeReady.workspacePath;
        const runtimeRef = runtimeReady.runtime ? runtimeReady.runtime.runtimeRef : undefined;
        const stateDirResolved = runtime.fs.resolveStateDir(workspacePath, session.id);
        const stateDirPath = stateDirResolved?.stateDirPath || null;
        const stateExists = stateDirPath && session.stateDirRef && await sessionStateDirExists(runtime.fs, {
            workspaceRoot: workspacePath,
            sessionId: session.id,
            runtimeRef,
            stateDirRef: session.stateDirRef,
        });
        if (!stateExists) {
            const error = new Error('session not resumable — please start a new session');
            error.statusCode = 409;
            throw error;
        }

        if (resolvedSpawnEnv?.env && resumeSpec.stateEnv && !resolvedSpawnEnv.env[resumeSpec.stateEnv]?.trim()) {
            resolvedSpawnEnv.env[resumeSpec.stateEnv] = stateDirPath;
        }

        if (project && project.repoProvider === 'github' && resolvedSpawnEnv?.env) {
            resolvedSpawnEnv.env.XENSEMBLE_GIT_BRANCH = project.currentBranch || '';
            resolvedSpawnEnv.env.XENSEMBLE_GIT_BASE_BRANCH = project.repoDefaultBranch || '';
            resolvedSpawnEnv.env.XENSEMBLE_REPO_URL = project.githubFullName || '';
        }

        const authMode = await agentGatewayConfig.getAgentAuthMode(agentMeta.id);
        let sessionToken = null;
        if (authMode === 'gateway') {
            const gwCfg = await agentGatewayConfig.getForAgent(agentMeta.id);
            sessionToken = issueSessionToken({
                sessionId: session.id,
                userId: requestUser.id,
                projectId: project.id,
                agentId: agentMeta.id,
                model: gwCfg?.model,
                role: requestUser.role,
            });
        }

        if (!resolvedSpawnEnv?.env) {
            const error = new Error('Failed to resolve spawn environment');
            error.statusCode = 400;
            throw error;
        }

        await db.update(schema.sessions)
            .set({
                status: 'running',
                streamRef: session.streamRef || null,
                stateDirRef: session.stateDirRef || null,
                recoverable: true,
            })
            .where(eq(schema.sessions.id, session.id));

        let handle;
        try {
            handle = await runtime.exec.spawn(
                agentMeta.cmd,
                [...agentMeta.args, ...(resumeSpec.resumeArgs || [])],
                resolvedSpawnEnv.env,
                {
                    name: agentMeta.name,
                    cwd: session.cwd,
                    runtimeRef: runtimeReady.runtime ? runtimeReady.runtime.runtimeRef : undefined,
                    uid: process.env.RUNTIME_UID,
                    gid: process.env.RUNTIME_GID,
                }
            );
        } catch (err) {
            await db.update(schema.sessions)
                .set({ status: session.status })
                .where(eq(schema.sessions.id, session.id));
            throw err;
        }

        handle.transcriptRef = transcriptRef;
        sessionManager.createSession(session.id, handle, agentMeta.id, {
            transcriptRef,
            projectId: session.projectId || null,
            runtimeId: session.runtimeId || null,
            runtimeRef: runtimeReady.runtime ? runtimeReady.runtime.runtimeRef : null,
            stateDirRef: session.stateDirRef || null,
            userId: requestUser.id,
        });
        await registerSessionLifecycle({
            db,
            schema,
            sessionManager,
            sessionId: session.id,
            project,
            fastifyLog,
        });

        await db.update(schema.sessions)
            .set({
                streamRef: handle.streamRef || null,
                stateDirRef: session.stateDirRef || null,
                recoverable: true,
            })
            .where(eq(schema.sessions.id, session.id));

        return {
            session_id: session.id,
            status: 'running',
            runtime_id: runtimeReady.runtime ? runtimeReady.runtime.id : session.runtimeId || null,
            stream_ref: handle.streamRef || null,
            recoverable: true,
            terminal_theme_id: terminalThemeId || null,
            spawn_env_preview: resolvedSpawnEnv.spawn_env_preview || null,
            state_dir_ref: session.stateDirRef || null,
            session_token: sessionToken,
        };
    });
}

module.exports = {
    resumeSession,
    registerSessionLifecycle,
    withResumeLock,
};
