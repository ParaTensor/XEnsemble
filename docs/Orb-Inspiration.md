# 《Putting an Agent in an Orb》对 XEnsemble 的启发

来源：https://ampcode.com/notes/putting-an-agent-in-an-orb （Amp / Thorsten Ball, 2026-07-02）

## 一句话核心

XEnsemble 本质上就是在做 Amp 的 "orb"——**一个把 AI agent 装进临时沙箱里跑的平台**。这篇文章不是竞品软文，而是一份「怎么让环境对 agent 友好」的实战蓝图。它的全部结论可以压成一句：

> **Don't make them guess.**（别让 agent 猜）

做法上就三件事反复出现：
1. **幂等脚本**（setup / resume / ensure-dev-server）——把环境推进到「已知良好状态」，agent 无脑跑一条命令即可，不用判断当前处于什么状态；
2. **自描述元数据**（`.amp/dev-ports.json`、遍地的 `AGENTS.md`）——端口、路径、约定写进文件，别硬编码、别靠猜；
3. **预检 / 铺路端点**（`/__dev/preflight`、`/__dev/log-me-in`）——环境主动告诉 agent「缺什么、怎么登录」，而不是让它撞墙后自己试错。

XEnsemble 已经有很强的底座（checkpoint/snapshot、idle-hibernate+wake、transcript 持久化、runtime 抽象），**缺的正是这层「可读性 / legibility」**。所以这篇文章对我们价值很大，而且大多是「补齐」而非「重造」。

下面分两个维度：**产品侧**（给跑在 XEnsemble 上的托管 agent 的能力）和**自研仓库侧**（让 Devin/agent 在我们自己代码库里更高效）。两者的原语其实是同一套。

---

## 对照矩阵：文章能力 → XEnsemble 现状 → 差距

| Amp 的做法 | XEnsemble 现状 | 差距 / 机会 |
|---|---|---|
| **Orb 预装工具集**（gh/amp、PG、Redis、tmux、ffmpeg、ripgrep、agent-browser…），系统提示词告诉 agent「你在 orb 里、apt-get 即可」 | `agentBoxImages.js` / `AgentBoxImageService.js` 有 agent 镜像目录，BoxLite 构建；`registry.js` = local/boxlite/k8s(未实现) | 镜像里到底预装了什么、如何扩装工具，缺一份「面向 agent 的沙箱能力清单」。可在 workspace 注入一段「你在 XEnsemble 沙箱内 + 如何装更多工具」的引导 |
| **`.agents/setup`**：每个新 orb 跑一次的幂等 bootstrap（起 PG、seed 用户、装 toolchain、`pnpm install`、写 orb 专属 `AGENTS.md`），跑完 **snapshot 复用 24h** | `previewContract.js` 只 seed `.agents/preview.json` + 起始 `index.html`；**没有** 任何 per-workspace 的 `setup` bootstrap hook | **最大的缺口 & 最高价值**。我们已经有 `repo_snapshots` / `workspace_checkpoints`，只差一个「新 workspace 创建时跑一次的幂等 setup hook + 跑完打快照」的约定。见下方 P0 |
| **`.agents/resume`**：每次唤醒跑，把 orb 恢复到正确状态（如重建网络连接） | 有 idle-hibernate（`idleHibernate.js`）+ wake/resume（`resumeSession.js`、`terminalBridge` 唤醒），但唤醒后**没有** per-workspace 的 resume hook 去重建易失状态（端口、后台进程、网络） | 加一个对称的 `.agents/resume` 约定：唤醒时跑一次，重新拉起 dev server / 重连。我们的 hibernate 是硬停而非 RAM suspend，唤醒后重建状态尤其必要 |
| **`ensure-dev-server.sh`**：一条脚本把 dev server 推到已知良好态（健康则复用、卡死则重启、没起则新起），并把端口写进 `.amp/dev-ports.json` 供其它脚本读取 | `LocalPreviewAdapter.js` 用临时空闲端口起预览，`localPreviewRegistry.js` **仅存内存**（重启即丢，注释里写明），端口只进 deployment 行的 `internalRef`，**无端口文件、无幂等 reconcile** | 两个改进：①「ensure-preview」幂等化（健康复用/卡死重启）；② 端口/URL 落到 workspace 内的元数据文件（如 `.agents/ports.json`），agent 和脚本读文件而非猜 `localhost` |
| **`/__dev/log-me-in/<email>`**（dev-only 魔法登录，绕开 OAuth/2FA/passkey）+ **`/__dev/preflight`**（JSON 就绪报告：secret 配了吗、server 健康吗、用户有 workspace/project/credits/API key 吗、CLI 能连吗） | 标准 JWT + refresh 登录（`routes/auth.js`），有零散的 `spawn-preview` / `gateway/status` 端点，但**没有** dev 魔法登录、**没有**统一 preflight 就绪 JSON | **第二高价值**。托管 agent 最痛的就是「登录进自己刚 build 出来的 app 去测」。给每个 workspace/session 提供：①dev-mode 免密登录 shim；②一个把「缺什么」一次说清的 preflight 端点。我们已有 `session/spawn-preview` 可扩展 |
| **聚合日志**：dev server 日志 + **浏览器 console（转发并打 `[browser]` 标签）** 都进 `.amp/in/server.log`，agent 一个 grep 就懂全局；`.amp/in` 是 agent 的「收件箱草稿区」 | `TranscriptStore.js` 按流存 `.transcript/*.ndjson`（终端 I/O 持久化，做得不错），但 preview 日志只在 `LocalPreviewAdapter` 内存 `logTail`；**无**浏览器 console 捕获、**无**单一可 grep 的聚合文件 | 把 preview / 浏览器 console 转发进一个持久化的 per-workspace 日志收件箱（复用 transcript 基建即可）。这对「agent 自查自己 build 的 web app」是关键闭环 |
| **遍地 `AGENTS.md`（41 个）**：按目录 on-demand 读，讲清怎么 build/run/test、坑在哪、约定是什么 | 仓库只有根 `AGENTS.md` + `desktop/AGENTS.md` + `docs/agents.md`；无 per-workspace 注入 | ①自研仓库侧：给 server/、gateway/、runtime/、session/ 等关键目录补 `AGENTS.md`（我们 runtime/session 逻辑复杂，收益大）；②产品侧：workspace 里 seed 一份 agent 引导（沙箱说明 + 铺路端点/脚本清单） |

---

## 落地建议（按优先级）

### P0 —「铺路」原语，最高杠杆 ✅ 已落地（2026-07-05）

1. **Workspace `.agents/setup` 幂等 bootstrap hook** — `server/src/workspace/agentBootstrap.js`；新 workspace 自动 seed + 本地 runtime 首次 `ensureReady` 时执行；`POST /api/v1/projects/:id/agents/setup` 可强制重跑；成功后写入 `repo_snapshots`。
2. **统一 preflight 就绪端点** — `GET /api/v1/projects/:id/preflight?agent_id=` → `server/src/workspace/preflight.js`（secrets / gateway / LLM / preview / quota / setup 状态 + hints）。

### P1 —「可观测」与「可复用」

3. **持久化 + 幂等化 preview（ensure-dev-server 版）**
   - 把 `localPreviewRegistry` 的内存态落盘（端口/URL/健康），重启可 reconcile；对外暴露幂等的「ensure-preview」：健康复用、卡死重启、没起新起。
   - 端口写进 workspace 内 `.agents/ports.json`，agent 读文件不硬编码。

4. **聚合日志收件箱 + 浏览器 console 转发**
   - 复用 `TranscriptStore` 基建，把 preview stdout/stderr 和浏览器 console（打 `[browser]` 标签）汇入一个持久、可 grep 的 per-workspace 日志文件。

### P2 —「引导」与「唤醒对称性」

5. **`.agents/resume` 唤醒 hook**：与 idle-hibernate 对称，唤醒时重建易失状态（重起 dev server、重连网络）。

6. **Per-workspace agent 引导注入**：seed 一份 workspace `AGENTS.md`（沙箱能力 / 装工具方式 / 铺路端点与脚本清单 / 日志路径 / 端口文件位置）。

7. **自研仓库补 `AGENTS.md`**：优先 `server/src/runtime/`、`server/src/session/`、`gateway/`——这些是我们逻辑最密、最易让 agent 猜错的地方。

---

## 一个值得内化的判断标准

文章末尾那句 agent 自评很好用，可作为我们做每个 workspace 功能时的「验收问句」：

> "The thing that stands out is how rarely I have to guess … the environment doesn't just tolerate an agent; it assumes one, and tells it where the light switches are."

即：**做每个能力时问自己——「agent 在这一步需要猜吗？」** 如果需要猜（端口、登录、当前状态、缺什么），就补一个幂等脚本 / 元数据文件 / preflight 端点，把灯的开关标出来。这正是 XEnsemble 相对通用云 IDE 的差异化护城河：不是「能跑 agent」，而是「为 agent 而生」。
