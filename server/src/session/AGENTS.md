# Session layer

Control-plane session lifecycle: spawn, terminal bridge, idle hibernate, L2 resume, recovery after restart. **Must align with [Architecture.md](../../../docs/Architecture.md).**

## Layout

| Path | Role |
|---|---|
| `SessionManager.js` | In-memory live sessions, hibernate state, exit callbacks |
| `resumeSession.js` | L2 resume: restore state dir, respawn agent with `--continue`, runs workspace `.agents/resume` on wake |
| `resumeSessionContext.js` | Builds auth/env/project context for resume |
| `terminalBridge.js` | SSE terminal stream; `resolveLiveSession()` triggers `wakeSession` for idle recoverable sessions |
| `idleHibernate.js` | Sweeps idle sessions → provider hibernate → DB status `idle` |
| `recoverRunningSessions.js` | Startup reconciliation for sessions left `running` in DB |
| `stateDir.js` / `stateDirRef.js` | Per-session agent state directory refs |

## Wake flow

1. Client reconnects to idle session (terminal SSE or input).
2. `terminalBridge` calls `wakeSession` → `resumeSession`.
3. `ensureProjectRuntime` restores workspace.
4. **`ensureAgentResume`** runs `.agents/resume` + server-side `ensure-preview`.
5. Agent respawns with resume args; transcript seq continues.

## L2 resume requirements

Agent must be registered with L2 resume spec in `agents/agentResume.js` (`stateEnv`, `resumeArgs`). Session needs `recoverable: true`, `stateDirRef`, and transcript stream.

## Tests

```bash
cd server && npm test -- src/session/*.test.js
```

Focus: `resumeSession.test.js`, `terminalBridge.test.js`, `idleHibernate.test.js`.

## Related

- Runtime provisioning: `server/src/runtime/AGENTS.md`
- Workspace hooks: `server/src/workspace/agentResumeHook.js`
