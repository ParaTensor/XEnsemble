---
name: testing-web-console
description: Test the XEnsemble web Console (browser agent terminal / M1) end-to-end against a live boxlite (blink-server) stack. Use when verifying Console/terminal UI or boxlite session behavior.
---

# Testing the XEnsemble Web Console (M1 web terminal)

The web Console (`client/src/pages/Console.jsx` + `client/src/components/AgentConsole.jsx`)
lets a user start a boxlite-backed agent session and interact with a live xterm terminal in the
browser over `/ws/v1/terminal`. This skill documents how to stand up the stack and prove it works.

## Stack to bring up
1. **blink-server** (libkrun microVM, needs `/dev/kvm`). Either run the released image
   `docker run --rm --device /dev/kvm -p 8787:8787 ghcr.io/eeroeternal/blink-server:v0.3.3`
   or the locally built `blink/target/release/blink-server --bind 0.0.0.0 --port 8787`.
   Verify: `curl http://127.0.0.1:8787/api/health`.
2. **XEnsemble server** with boxlite provider:
   `RUNTIME_PROVIDER=boxlite BLINK_API_URL=http://127.0.0.1:8787 XENSEMBLE_WORKSPACE_PATH=/workspace PORT=3888 node src/server.js`
   Build the client first (`cd client && npm run build`); the server serves `client/dist`.
   Start it as a persistent background process — a plain `( ... & )` subshell may get reaped;
   check `ss -ltnp | grep 3888` and watch for `EADDRINUSE` (an old server still bound).
3. Admin user: `node scripts/manage-user.js create-admin <user> <pass>`.

## Making an agent available + interactive (test harness)
- The Console's agent dropdown only lists **installed** agents. `installed` is decided by
  `agentProbe.js` resolving the agent's `cmd` on PATH. Real agent CLIs (`kimi`, `claude`, ...)
  aren't preinstalled in the default Alpine guest, so the list is empty by default.
- Workaround: point an agent's `cmd` at a shell that exists in the guest so you get a real
  interactive PTY: set `cmd='sh', args=['-i']` for e.g. `kimi-code` directly in the DB
  (`server/data/emdash.db`, table `agents`).
- **Gotcha:** the server **re-seeds the agents table on every boot**, reverting `cmd` back to
  its default. Apply the DB tweak *after* the server has started, and re-apply after any restart.
- This is a runtime-only harness, NOT a code change — don't commit it.

## Proving the terminal is really in the microVM (not the host)
Type in the browser terminal and check output:
- `uname -r` → guest kernel (e.g. `6.12.x`), must NOT be the host kernel (`5.15.x`).
- `head -1 /etc/os-release` → `Alpine Linux`.
- `echo hello-from-$(hostname)` → round-trips (proves bidirectional bridge).
- Resize: `stty size` before/after resizing the browser window — the `rows cols` must change
  (proves the `{type:'resize'}` frame reaches the guest PTY). Use `wmctrl` to un-maximize +
  set a fixed smaller geometry, then re-maximize; click *inside* the terminal before typing.
- `exit` → terminal header flips to `ENDED` and the session pill flips to `exited`.

## Known bug class to watch for
`POST /api/v1/session/start` returning 500 with "Failed to start agent session" toast and no
terminal: check `/tmp/xensemble.log`. A `ReferenceError` there (e.g. a runtime handle referenced
outside the `try` block that declared it) blocks *all* session starts — this was fixed in
ParaTensor/XEnsemble#17. If you see a 500 on session start, tail the server log before assuming
the frontend is at fault.

## Recording tips
- Maximize the window before recording: `wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`.
- For resize testing the reflow-on-maximize can hide scrollback; do a clean two-size comparison
  (`clear`, `stty size` at size A, resize to a fixed geometry, `stty size` at size B).

## Devin Secrets Needed
None. Everything runs locally on a VM with `/dev/kvm`; the admin user is created locally.
