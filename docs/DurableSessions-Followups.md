# Durable Sessions — Follow-ups & Optimization Backlog

Companion to [`DurableSessions.md`](./DurableSessions.md). Captures issues and
optimization opportunities discovered while implementing P1–P4 and while
running the boxlite/blink end-to-end verification. Ordered roughly by impact.

Status legend: **[resolved]** landed, **[open]** not yet scheduled.

---

## 1. Resume state-dir resolution — start/resume consistency **[resolved: PR #29]**

**Symptom.** Under boxlite, an idle-hibernated session (P4) could never be
woken: every wake returned `409 session not resumable` and the session stayed
`idle` forever — strictly worse than not hibernating.

**Root cause.** The agent state dir was resolved *differently* at start vs.
resume:

- start (`server.js` → `ensureSessionStateDir` → `projectDir`) →
  `<WORKSPACE_ROOT>/<uid>/<pid>/.xensemble/state/<sid>` (host path).
- resume (`resumeSession.js`) → `resolveSafePath(project.serverPath, ref)`,
  where under boxlite `project.serverPath` is the *in-box* `/workspace`, i.e.
  `/workspace/.xensemble/state/<sid>` — then `fs.existsSync` was evaluated on
  the **host**, where `/workspace` does not exist → 409.

Even had the guard passed, the agent would have received a different `stateEnv`
value on resume than at start → it would not find its prior state → context
loss. Local was unaffected (`projectDir == serverPath`), which is why the P2 /
#27 Resume button verified fine on Local; P4 made it user-visible because
hibernation only happens under boxlite.

**Fix.** Resume now derives the state dir the same way start does, via
`resolveSessionStateDir(userId, projectId, sessionId)`, so the absolute path is
identical across start and resume.

**Deeper follow-up (see §2).** The fix keeps the current "host absolute path,
also reachable inside the box" behavior. That is correct today only because the
boxlite dev setup surfaces the workspace at the same path the control plane
uses. It should not depend on the control plane and the box agreeing on a host
filesystem layout.

## 2. State dir should be a runtime-FS contract, not a host-FS assumption **[open]**

The control plane resolves and `fs.existsSync`-checks the session state dir on
its **own** filesystem. For Local this is the workspace; for boxlite it happens
to work because the box shares the path, but conceptually the state dir lives on
the **box disk**. The control plane should never assume it can `stat`/`mkdir`
the box's filesystem directly.

Proposed: add `exists(path)` / `mkdirp(path)` (and a canonical
`resolveStateDir(session)`) to the runtime exec/FS abstraction, and have both
start and resume go through it. Local implements it against the host FS; boxlite
implements it against the box FS (via blink). This removes the last place where
the control plane reaches into a runtime's filesystem by host path, and makes
the P4 wake path correct even when the box disk is fully isolated from the host.

## 3. Per-agent boxlite images (glibc + node + agent CLI) **[open]**

Real agents cannot run in the stock box image: it is Alpine/musl, has no
`node`, and no egress, while e.g. `droid` is a ~150 MB glibc ELF. This is why
the P4 boxlite e2e had to use a shell stand-in agent — the mechanism under test
(idle detection → `stop` → wake via `--resume`) is agent-independent, but a
real-model transcript cannot be produced in-box today.

Needed: a build/publish pipeline that produces per-agent images (glibc base +
`node` + the agent CLI, credentials injected at spawn) and a way for blink to
load them (`BLINK_IMAGE` / rootfs URL per agent). Until then, real-agent boxlite
e2e is blocked; the real-model context-continuity guarantee is only verified on
Local (P2 / #27).

## 4. blink-server self-restart recovery of live executions **[open]**

blink PR #9 (durable reattach) makes an execution survive **control-plane**
restarts (buffered, seq-cursored, repeatable attach). It does **not** cover
blink-server restarting: `ExecRegistry` is in-memory, so a live execution is
lost if blink-server itself restarts. Closing this needs boxlite support for
re-opening the stdio of a still-running in-box process. Tracked as a blink-side
follow-up.

## 5. Terminal OSC/DA escape-sequence echo-loop **[open]**

Observed while testing #27: on terminal attach, a device-attributes / OSC
response (`1;2c … rgb:2e2e/3434/4040`) is echoed back into the agent's stdin and
can flood it. It reproduces on a fresh attach and is unrelated to the resume
work, but it blocks reliably driving an interactive agent (e.g. asking it to
recall a value) through the web terminal. Worth isolating: identify who emits
the DA/OSC query and stop feeding the terminal's reply back into the PTY input.

## 6. State-dir isolation for agents that hardcode `$HOME` **[open]**

P2 L2 integration relies on an agent exposing a **dedicated** state-dir env var
(`stateEnv`, e.g. `CLAUDE_CONFIG_DIR`, `FACTORY_HOME_OVERRIDE`). Agents that
hardcode `os.homedir()/.<tool>` (e.g. CommandCode → `~/.commandcode`) have no
such knob; the only redirect is `HOME`, which our P2 design deliberately does
not touch (broad blast radius: git/ssh/npm config the agent reads from `HOME`).
Such agents are therefore CLI-level L2 but not L2-integrable as-is.

Options to evaluate: per-session `HOME` overlay inside the sandbox (cheap under
boxlite, where the box already isolates `HOME`), or a small per-agent "state
relocation" shim. Decision deferred; CommandCode left at L0 for now.

## 7. More harness L2 verification **[open]**

Only Claude Code (doc-level) and Factory Droid (CLI-tested) are catalogued as
L2. Adding an agent to L2 requires verifying, with its real CLI + key, both its
state-dir redirect env var and its native resume flag. Backlog: Codex and
others, each gated on credentials.

## 8. Test suite: parallel runs share one sqlite DB **[open]**

`npm test` runs many `*.test.js` files in parallel (`node --test`) against a
single on-disk `emdash.db`. Session/git suites then flake against each other
(rows created/deleted concurrently), producing failures that vanish when a file
is run alone — this actively obscured signal while verifying #29. Options: give
each test file its own DB (temp file or `:memory:`), or run DB-touching suites
serially. Low risk, high signal-to-noise payoff.

## 9. Hibernation for non-resumable (L0/L1) agents **[open]**

P4 uses a hard-stop model: `stop` frees CPU/RAM, wake does a full agent
`--resume`, so only L2 (natively resumable) agents survive hibernation with
context. L0/L1 agents must be excluded from hibernation (or they lose context on
wake). A future option is a true memory checkpoint/restore (blink already has
`checkpoint`/`restore`; `warm` is currently a no-op) so L0/L1 sessions can also
be suspended and resumed without agent-native support.

## 10. P5 semantic events (optional enhancement) **[open]**

Level-tiered lifecycle events / webhooks (e.g. notify on hibernate/wake, expose
`recoverable`/`level` transitions to clients). Progressive enhancement, not
required by P1–P4.
