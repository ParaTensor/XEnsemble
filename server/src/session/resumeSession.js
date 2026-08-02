const { eq } = require('drizzle-orm');
const { sessionStateDirExists, prepareHomeRedirect } = require('./stateDir');
const { getAgentResume, getAgentResumeLevel, isSessionRecoverable, buildStateArgs } = require('../agents/agentResume');
const transcriptStore = require('../runtime/TranscriptStore');

const CRASH_UPTIME_MS = 30000;
const CRASH_THRESHOLD = 3;

async function resolveCustomImageRef(customImageId, userId) {
    const { getReadyImageRef } = require('../runtime/CustomImageService');
    return getReadyImageRef(customImageId, userId);
}

const inFlightResumes = new Map();

const RESUME_LOCK_TIMEOUT_MS = Number(process.env.RESUME_LOCK_TIMEOUT_MS) || 30000;

function withResumeLock(sessionId, fn) {
    const existing = inFlightResumes.get(sessionId);
    if (existing) return existing;
    const timeout = setTimeout(() => {
        if (inFlightResumes.get(sessionId) === pending) {
            inFlightResumes.delete(sessionId);
        }
    }, RESUME_LOCK_TIMEOUT_MS);
    const pending = Promise.resolve().then(fn).finally(() => {
        clearTimeout(timeout);
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
        const live = sessionManager.getSession(sessionId);
        if (live && !live.hibernating) {
            const uptime = Date.now() - (live.spawnedAt || 0);
            if (uptime < CRASH_UPTIME_MS) {
                live.crashCount = (live.crashCount || 0) + 1;
            } else {
                live.crashCount = 0;
            }
        }
        const circuitTripped = live && (live.crashCount || 0) >= CRASH_THRESHOLD;
        const nextStatus = live && !live.hibernating && !circuitTripped && isSessionRecoverable(live) ? 'idle' : 'exited';
        db.update(schema.sessions)
            .set({ status: nextStatus })
            .where(eq(schema.sessions.id, sessionId))
            .catch((err) => fastifyLog.error(err, 'Failed to persist session exit status'));

        if (project && project.workspaceMode === 'git') {
            const { GitOperationService } = require('../github/GitOperationService');
            const gitOps = new GitOperationService({ getToken: () => null });
            // Check for dirty state first (1 VM exec) to skip the 3-exec commitAll
            // when there's nothing to commit (the common case on clean exit).
            gitOps._execGit(project, ['status', '--porcelain'])
                .then((r) => {
                    if (!r.stdout || !r.stdout.trim()) return null;
                    return gitOps.commitAll(project, `chore(xensemble): auto-checkpoint session ${sessionId}`);
                })
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
                shell_only: session.agentId === 'shell' || undefined,
            };
        }

        // Shell-only session: runtime is the shell itself, no agent to resume.
        if (session.agentId === 'shell') {
            const runtimeReady = await ensureProjectRuntime(project, {
                runtimeId: session.runtimeId || undefined,
                agentId: 'shell',
                ...(session.customImageId ? { image: await resolveCustomImageRef(session.customImageId, requestUser.id) } : {}),
            });

            await db.update(schema.sessions)
                .set({ status: 'running' })
                .where(eq(schema.sessions.id, session.id));

            return {
                session_id: session.id,
                status: 'running',
                runtime_id: session.runtimeId || null,
                stream_ref: session.streamRef || null,
                recoverable: false,
                terminal_theme_id: terminalThemeId || null,
                spawn_env_preview: null,
                state_dir_ref: null,
                shell_only: true,
                custom_image_id: session.customImageId || null,
            };
        }

        // --- regular agent session resume below ---

        const resumeSpec = getAgentResume(agentMeta.id);
        if (getAgentResumeLevel(agentMeta.id) !== 'L2' || (!resumeSpec?.stateEnv && !resumeSpec?.stateArgs && !resumeSpec?.redirectHome) || !session.stateDirRef || !session.recoverable) {
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
            ...(session.customImageId ? { image: await resolveCustomImageRef(session.customImageId, requestUser.id) } : {}),
        });

        const workspacePath = runtimeReady.workspacePath;
        const runtimeRef = runtimeReady.runtime ? runtimeReady.runtime.runtimeRef : undefined;

        // authMode is a DB query (no VM exec) - safe to start early.
        const authModePromise = agentGatewayConfig.getAgentAuthMode(agentMeta.id);

        // Run ensureAgentResume (host bash) and sessionStateDirExists (VM exec) in parallel.
        // ensureAgentResume is host-side (not VM exec), so no zygote race with sessionStateDirExists.
        const stateDirResolved = runtime.fs.resolveStateDir(workspacePath, session.id);
        const stateDirPath = stateDirResolved?.stateDirPath || null;

        const [_, stateExists] = await Promise.all([
            (async () => {
                try {
                    const { ensureAgentResume } = require('../workspace/agentResumeHook');
                    await ensureAgentResume(project, workspacePath, {
                        sessionId: session.id,
                        onWake: true,
                    });
                } catch (err) {
                    if (fastifyLog?.warn) {
                        fastifyLog.warn(err, '[sessions] workspace resume hook failed');
                    } else if (requestLog?.warn) {
                        requestLog.warn(err, '[sessions] workspace resume hook failed');
                    }
                }
            })(),
            (async () => {
                if (!stateDirPath || !session.stateDirRef) return false;
                return sessionStateDirExists(runtime.fs, {
                    workspaceRoot: workspacePath,
                    sessionId: session.id,
                    runtimeRef,
                    stateDirRef: session.stateDirRef,
                });
            })(),
        ]);

        if (!stateExists) {
            const error = new Error('session not resumable - please start a new session');
            error.statusCode = 409;
            throw error;
        }

        // Check if the state directory has conversation data (not just config files).
        // If resumeCheckSubdir is set and the subdirectory is empty, skip resumeArgs
        // and start fresh (e.g. claude-code --continue fails with "no conversation found"
        // when the sessions/ subdirectory is empty).
        let canResume = true;
        if (resumeSpec.resumeCheckSubdir && stateDirPath) {
            try {
                const checkDir = `${stateDirPath}/${resumeSpec.resumeCheckSubdir}`;
                const result = await runtime.exec.exec(
                    'sh', ['-c', `test -n "$(ls -A '${checkDir}' 2>/dev/null)"`],
                    {}, { runtimeRef, cwd: '/' }
                );
                canResume = result.exitCode === 0;
            } catch {
                canResume = true; // Conservative: allow resume if check fails
            }
        }

        if (resolvedSpawnEnv?.env && stateDirPath) {
            const path = require('path');
            if (resumeSpec.stateEnv && !resolvedSpawnEnv.env[resumeSpec.stateEnv]?.trim()) {
                resolvedSpawnEnv.env[resumeSpec.stateEnv] = stateDirPath;
            }
            if (resumeSpec.extraStateEnvs) {
                for (const [envName, suffix] of Object.entries(resumeSpec.extraStateEnvs)) {
                    if (!resolvedSpawnEnv.env[envName]?.trim()) {
                        resolvedSpawnEnv.env[envName] = path.join(stateDirPath, suffix);
                    }
                }
            }
            if (resumeSpec.redirectHome) {
                resolvedSpawnEnv.env.HOME = stateDirPath;
                const stateDirRef = session.stateDirRef || stateDirResolved?.stateDirRef;
                if (stateDirRef) {
                    await prepareHomeRedirect(runtime.fs, {
                        workspaceRoot: workspacePath,
                        stateDirRef,
                        runtimeRef,
                    }).catch((err) => {
                        if (fastifyLog?.warn) fastifyLog.warn({ err }, '[sessions] prepareHomeRedirect failed');
                        else if (requestLog?.warn) requestLog.warn({ err }, '[sessions] prepareHomeRedirect failed');
                    });
                }
            }
        }

        if (project && project.repoProvider === 'github' && resolvedSpawnEnv?.env) {
            resolvedSpawnEnv.env.XENSEMBLE_GIT_BRANCH = project.currentBranch || '';
            resolvedSpawnEnv.env.XENSEMBLE_GIT_BASE_BRANCH = project.repoDefaultBranch || '';
            resolvedSpawnEnv.env.XENSEMBLE_REPO_URL = project.githubFullName || '';
        }

        // ensureKimiConfig (VM exec) runs AFTER sessionStateDirExists completes
        // to avoid concurrent VM execs triggering the zygote race on a freshly
        // resumed VM. It is best-effort.
        const kimiConfigPromise = (async () => {
            try {
                const { ensureKimiConfig } = require('../workspace/kimiConfigBootstrap');
                await ensureKimiConfig({
                    runtime,
                    runtimeRef,
                    userId: requestUser.id,
                    agentId: agentMeta.id,
                    warn: (msg) => {
                        if (fastifyLog?.warn) fastifyLog.warn(msg);
                        else if (requestLog?.warn) requestLog.warn(msg);
                    },
                });
            } catch (err) {
                if (fastifyLog?.warn) {
                    fastifyLog.warn(err, '[sessions] kimi config bootstrap failed');
                } else if (requestLog?.warn) {
                    requestLog.warn(err, '[sessions] kimi config bootstrap failed');
                }
            }
        })();
        const [authMode] = await Promise.all([authModePromise, kimiConfigPromise]);

        // Write user-provided config files AFTER bootstrap (kimiConfig, etc.)
        // so user-provided files take precedence over bootstrap defaults.
        const { writeConfigFilesToVM, applyCustomEnv, getSessionConfig, resolveAgentSpawnArgs } = require('./sessionConfig');
        const userConfig = await getSessionConfig(db, schema, session.id);
        if (userConfig.configFiles.length) {
            await writeConfigFilesToVM(runtime.fs, {
                workspaceRoot: workspacePath,
                runtimeRef,
                configFiles: userConfig.configFiles,
                stateDirPath: stateDirPath || null,
            }).catch((err) => {
                if (fastifyLog?.warn) fastifyLog.warn({ err }, '[sessions] resume writeConfigFilesToVM failed');
                else if (requestLog?.warn) requestLog.warn({ err }, '[sessions] resume writeConfigFilesToVM failed');
            });
        }
        if (Object.keys(userConfig.customEnv).length && resolvedSpawnEnv?.env) {
            resolvedSpawnEnv.env = applyCustomEnv(resolvedSpawnEnv.env, userConfig.customEnv);
        }

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

            // ── Try reattach to old execution first ──
            // If the old agent process is still alive in the VM (WebSocket died
            // but process didn't), reattaching avoids:
            //   1. Killing the agent mid-tool-execution (causes deadlocks)
            //   2. Losing conversation context by spawning without --continue
            if (session.streamRef) {
                try {
                    const cursor = transcriptStore.reattachCursor(transcriptRef);
                    if (cursor != null) {
                        const reattached = await runtime.provider.attachSession(
                            session.id, session.streamRef, { after: cursor },
                        );
                        if (reattached && typeof reattached.onData === 'function' && typeof reattached.onExit === 'function') {
                            handle = reattached;
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
                                db, schema, sessionManager, sessionId: session.id, project, fastifyLog,
                            });
                            await db.update(schema.sessions)
                                .set({ status: 'running', recoverable: true })
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
                                reattached: true,
                            };
                        }
                    }
                } catch (_) {
                    // Reattach failed - fall through to spawn new process
                }
            }

            // ── Reattach failed, spawn new agent ──
            const stateArgs = stateDirPath
                ? buildStateArgs(resumeSpec, stateDirPath)
                : [];

            // Resolve resume args: if resolveResumeArgs is defined, call it
            // to dynamically determine args (e.g. --id <last-session-id>).
            // Falls back to static resumeArgs.
            let resumeArgs = [];
            if (canResume) {
                if (typeof resumeSpec.resolveResumeArgs === 'function') {
                    try {
                        resumeArgs = await resumeSpec.resolveResumeArgs({
                            exec: runtime.exec.exec.bind(runtime.exec),
                            env: resolvedSpawnEnv.env,
                            runtimeRef,
                            stateDirPath,
                            fs: runtime.fs,
                        });
                    } catch (_) {
                        resumeArgs = resumeSpec.resumeArgs || [];
                    }
                } else {
                    resumeArgs = resumeSpec.resumeArgs || [];
                }
            }

            // Kill any lingering agent process from a previous run.
            if (runtimeRef) {
                try {
                    await runtime.exec.exec('pkill', ['-f', agentMeta.cmd || agentMeta.id], {}, {
                        runtimeRef, cwd: '/', timeoutMs: 5000,
                    });
                } catch (_) { /* best-effort */ }
            }

            handle = await runtime.exec.spawn(
                agentMeta.cmd,
                [...stateArgs, ...agentMeta.args, ...resumeArgs, ...resolveAgentSpawnArgs(agentMeta.id, userConfig.configFiles)],
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

        // Single DB update with the final streamRef (merged from 2 writes).
        await db.update(schema.sessions)
            .set({
                status: 'running',
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
