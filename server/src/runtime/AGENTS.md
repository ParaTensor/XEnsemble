# Runtime layer

Execution surface for agent sessions, workspace FS, previews, and provider abstraction. **Must align with [Architecture.md](../../../docs/Architecture.md).**

## Layout

| Path | Role |
|---|---|
| `registry.js` | `getRuntime()` — resolves Local / BoxLite / K8s provider from env |
| `RuntimeService.js` | `ensureProjectRuntime()` — provisions workspace + runtime row |
| `interfaces.js` | `RuntimeProvider`, `PreviewAdapter`, `FsAdapter`, `RuntimeError` |
| `LocalRuntimeProvider.js` | Local-only: PTY spawn, workspace on disk, agent bootstrap on `ensureReady` |
| `LocalPreviewAdapter.js` | Starts preview process; logs to `.agents/in/server.log`; ports in `.agents/ports.json` |
| `localPreviewRegistry.js` | In-memory preview processes + disk reconcile |
| `previewContract.js` | `.agents/preview.json` + default `index.html` |
| `TranscriptStore.js` | Session terminal NDJSON persistence |

## Rules

- **Local-only code** (PTY, `fs.*` on workspace, preview child processes) stays inside `Local*` files with that assumption explicit.
- Control plane calls `getRuntime()` — never spawn PTY directly from routes.
- Preview is a **deployment** resource (`DeploymentService`), not the agent shell session.

## Tests

```bash
cd server && npm test -- src/runtime/*.test.js
```

Key suites: `LocalPreviewAdapter.test.js`, `previewHealth.test.js`, provider/registry tests.

## Related docs

- Workspace agent hooks: `server/src/workspace/AGENTS.md` (if present) and `docs/Orb-Inspiration.md`
- Session wake/resume: `server/src/session/AGENTS.md`
