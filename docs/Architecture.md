# XEnsemble 系统架构

**唯一系统架构规范**。执行面迁移到独立云环境、Preview/Deployment 服务、Runtime 抽象、Workspace 存储等所有后端实现与重构必须严格对齐本文。

前端 UI / 交互规范以 **`docs/Designs.md`** 为唯一规范（Console 面、Settings 弹窗、Toast、表单等细则均见该文档）；**勿在本文重复 UI 细节**。

Agent 注册、`env_required`、Vault 注入与启动逻辑见 `docs/agents.md`（本文补充架构层面的对齐要求）。

## 1. 目标与核心原则

- **执行面独立可迁移**：Agent 的 PTY、命令执行、文件读写发生在独立于控制面的云端 Runtime（容器 / 轻量 VM / 沙箱）。控制面（Fastify server）仅负责编排、鉴权、桥接与元数据。
- **云端部署与运行是核心价值**：客户“开发后看效果”主要通过云上 Preview URL（可公开或租户内访问），而非本地 localhost。支持从 Runtime 内的代码一键/Agent 触发 Preview 部署。
- **控制面稳定**：客户端 WebSocket 终端协议（/ws/v1/terminal）、核心 REST API、Console 交互模式保持不变或向后兼容。新增能力通过新端点与资源暴露。
- **Dev/Prod 一致性**：本地开发使用 Local 实现完全模拟云路径；禁止在控制面或非 Local 模块直接硬编码本机 FS/PTY 假设。
- **隔离与成本可控**：Project 级 Runtime 持久化；Preview 有独立生命周期与 TTL；资源限额、强隔离（不同 project/user 不同容器）。
- **可演进**：支持多种 Runtime Provider（K8s、Docker、本地 SSH、Cloudflare Sandbox 等）；Workspace 支持 Git 作为事实来源。

## 2. 当前状态（MVP 单体）

- 控制面与执行面**同机 colocate**：`server/src/server.js` + `SessionManager` + `LocalPtyExecutor`（node-pty） + `workspace.js` 直接操作 `WORKSPACE_ROOT/{userId}/{projectId}`（由 `process.env.WORKSPACE_ROOT` 或默认 `server/data/workspaces` 决定）。
- Session：DB 持久化元数据 + 内存 PTY 句柄（server 重启后无法恢复活跃终端）。
- Workspace 文件：仅读 API（`/api/v1/workspace/files`、`.../file`），使用本地 fs + `resolveSafePath` jail；写操作仅通过 Agent 在终端内完成。
- 无 Preview/Deployment 资源：无公网 URL、无 build 流水线、无 port 暴露。
- 限制：无法为客户提供独立云端部署效果；执行无法水平扩展或按项目隔离到独立环境；多 server 实例时 SessionManager 不共享。

架构已是 B/S 服务端驱动（前端仅 Console + WS 终端），但执行面未解耦。

## 3. 目标分层架构

```
Client (Console)
   │  REST + WS (stable protocol)
   ▼
Control Plane (server)
  ├─ Auth / Secrets Vault
  ├─ API Orchestration (projects, sessions, agents, deployments)
  ├─ SessionManager (bridge, not direct pty owner)
  ├─ Preview Gateway / Proxy (initially in-process, prod via ingress)
  └─ DB (metadata: users, projects, sessions, agents, secrets, deployments)
   │
   ├─ RuntimeExecutor (interface / adapter)
   │     ▲
   │     │  spawnPty / exec / fs* / startUserApp / metrics
   ▼     │
Execution Plane (pluggable providers)
  ├─ LocalPtyExecutor     (仅 dev，用于单机模拟)
  ├─ DockerRuntimeExecutor
  ├─ K8sRuntimeExecutor
  ├─ RemoteSandboxExecutor (SSH / gRPC / platform SDK)
  └─ ...
   │
   ▼
Per-Project Runtimes (cloud sandboxes / containers)
  ├─ Persistent workspace volume (or git-backed)
  ├─ Agent PTY (claude / cursor / kimi ...)
  └─ User App processes (for preview: npm run dev, etc.)
         │
         ▼
Storage Layer (volumes / git / object) + Preview Ingress (public URLs)
```

- **Control Plane**：无状态或弱状态（除内存 bridge）；可多实例（需外部化 Session 桥接状态或 sticky）。
- **Execution Plane**：强状态（PTY、FS）。Provider 负责生命周期（provision、attach、destroy）。
- **Preview / Deployment Plane**：与 Agent Shell 解耦但可共用 Runtime 资源。负责用户应用的构建、运行、端口注册、URL 分配。独立于 agent 的“shell session”。
- **Gateway**：将 preview public URL 反向代理到 runtime 内部端口。初期可用 control plane 的 http-proxy 实现；生产推荐独立 ingress + wildcard DNS。

## 4. 核心领域模型（建议扩展 schema）

现有表（保持兼容）：
- users, secrets (encrypted), agents (注册表), projects (id, userId, name, **serverPath** → 演进为 workspaceRef), sessions (id, userId, projectId, agentId, cwd, status, createdAt)

新增 / 演进：
- **runtimes**（可选显式表）或 project 扩展字段：
  - runtime_provider: 'local' | 'docker' | 'k8s' | ...
  - runtime_ref: provider-specific id / pod / container / sandbox_id
  - status, endpoint (internal), specs (cpu/mem), createdAt
- **deployments**（核心，用于 preview 看效果）：
  - id, projectId, kind: 'preview' | 'staging' | 'prod'
  - status: 'pending' | 'building' | 'running' | 'failed' | 'stopped'
  - publicUrl: 'https://preview-xxx.yourdomain'
  - internalRef: runtime + port / service name
  - revision: gitSha | snapshotId | 'latest'
  - expiresAt (preview TTL), createdAt, updatedAt
  - buildLog / runtimeLog (可选外链或截断存储)

projects.serverPath 在 Local provider 下仍可直接映射；云 provider 下为逻辑 ref，实际路径在 runtime 内。

sessions 可增加 deployment_snapshot 或仅通过 project 关联当前活跃 preview。

## 5. 关键流程（对实现有约束）

### 5.1 启动 Agent Session（支持远程 Runtime）

1. `POST /api/v1/session/start`（agent_id + project_id）
2. Control 鉴权 → 取 project → 解析其 runtime_provider / ref → 调用 RuntimeProvider.ensureReady(project)（本地 mkdir 或云 provision/attach）。
3. 取 user Secrets → `executor.spawn(cmd, args, envs, userId, {cwd: runtimeWorkspacePath, ...})`
   - Local：当前 node-pty 逻辑（封装为 LocalPtyExecutor）。
   - 远程：向 runtime 发起远程 exec 请求，返回 stream handle（WS / multiplexed channel）。
4. `SessionManager.createSession(sessionId, streamHandle, agentId)`（泛化，不再只存 ptyProcess）。
5. 写 DB sessions（cwd 仍存逻辑路径）。
6. Client 连 `ws://.../ws/v1/terminal?sessionId=...`
   - Control plane 接受 WS，**内部桥接** input → runtime stream，runtime output → client。
   - 历史缓冲、resize、metrics（远程 metrics 由 runtime 提供或 sidecar）仍由 SessionManager 管理。
   - 协议**完全不变**。

Kimi Code 等特殊 Esc hack 保留在启动后处理层。

### 5.2 Workspace 文件操作（必须走抽象）

- 现有 `/api/v1/workspace/files?project_id=` 与 `/file?project_id=&path=` **必须改为委托模式**：
  - 根据 project 解析当前 runtime。
  - 调用 `runtime.fsList(relativePath)` / `runtime.fsRead(path)`。
- Local 实现：保留原有 `workspace.js` 的 `resolveSafePath` + fs 逻辑（封装为 LocalFsAdapter）。
- 远程实现：runtime 暴露受控 FS 接口（推荐：轻量 sidecar HTTP 或通过已连接的 agent 执行 `ls`/`cat` 并结构化返回；或共享存储层由 control 直接安全读）。
- **禁止**在 server.js 或非 Local 模块直接 `fs.existsSync(project.serverPath)` 或 `fs.readdirSync`。
- 写操作：保持“仅 Agent 终端内完成”的产品约束；未来可加受控 write API（必须经 runtime 授权）。

### 5.3 Preview 部署与“看效果”（云端核心路径）

1. 触发：Console 按钮（“Deploy Preview”）或 Agent 通过平台工具/API 调用（`requestPreview(projectId)`）。
2. Control 创建 `Deployment` 记录（kind=preview）。
3. `PreviewManager.deploy(project)`：
   - 确保 runtime 就绪。
   - 通过 runtime 执行“启动预览”契约：
     - 优先读项目内 `.agents/preview.skill.md` 或 `package.json` scripts（dev/start/build）。
     - 或平台约定的启动命令 + ready 探测（端口或日志匹配）。
   - 在 runtime 内启动用户应用进程（可为后台进程，非 agent PTY；或 agent 另开一个 PTY 跑 `npm run dev`）。
   - 发现暴露端口（约定或扫描）。
4. 分配/注册 public URL（子域名 + Gateway 路由规则）。
5. 更新 Deployment 状态 + publicUrl。
6. 返回给 Console。
7. Console 展示（遵 Designs.md）：状态徽章、URL（可点击/iframe）、刷新、重启、停止、TTL 倒计时。支持在预览页注入元素选择/错误上报（后期 Visual QA）。

正式部署（staging/prod）流程类似，但：
- 使用隔离的 runtime 或同一 runtime 的不同 profile。
- 注入生产 Secrets（与 dev preview 隔离）。
- 无 TTL 或更长生命周期。
- 可能走外部 CI/CD 通道（平台仅触发）。

Preview 与 Agent Session **解耦**：可以没有活跃 agent session 时仍有 preview 运行；agent session 结束不自动杀 preview。

### 5.4 Runtime 生命周期

- Project 创建时：可选立即 provision runtime（或 lazy：首次 session/preview 时）。
- Runtime 停止/销毁：显式 API 或闲置 TTL（preview 更激进）。
- 迁移/重建：保留 workspace 卷，换新 runtime 容器，重新 attach。

## 6. 存储策略

- **首选 Git 作为事实来源**：project 记录 repo URL + branch + lastSync。Runtime attach 时 `git clone/pull`；Agent 改动可 `git commit/push` 或由平台做 checkpoint。
- **卷持久化**：K8s PVC / 云盘 per project。Local 下映射为目录。
- **对象存储快照**：用于备份/回滚/跨 provider 迁移。
- 当前 `WORKSPACE_ROOT` 仅 LocalProvider 内部实现细节；云场景下 server 本地不应有完整 workspace 副本（除缓存）。

## 7. 安全、隔离、运维

- Runtime 必须以最小权限运行；Secrets 仅启动时注入，运行中不持久化在镜像。
- 路径 jail、命令白名单在 runtime 侧或 adapter 侧强制。
- Preview URL 保护：短期 token + Console 登录态校验；或 project 级共享密钥。
- 资源：runtime spec 受 tier 限制；Preview 进程可单独限额。
- 可观测：metrics（现有 ps 逻辑 → runtime 提供）、日志聚合（terminal 历史 + preview build/runtime log）。
- 多租户：project/user 维度严格隔离 runtime；control plane 仅持有 ref，不直接操作远端 FS/PTY。

## 8. 实现映射与约束（当前代码基线）

必须改动/抽象的位置（对齐时逐一检查）：

- `server/src/runtime/Executor.js` → 重构为 `interface RuntimeExecutor` + `LocalPtyExecutor` 实现（当前逻辑完整保留在 Local 内）。导出工厂或按配置注入。
- `server/src/workspace.js` → 拆分为 `FsAdapter` + `LocalFsAdapter`；`createProjectDirectory` 仅 Local 有效，或委托 provider。
- `server/src/server.js`：
  - session/start 流程插入 runtime ensureReady + delegate spawn。
  - workspace/* 路由改为 `await runtime.fs*`。
  - 新增 `/api/v1/deployments`（CRUD + startPreview/stopPreview for project）。
  - WS terminal 保持不变，内部由 SessionManager bridge。
- `server/src/session/SessionManager.js`：泛化内部句柄（支持 stream 而非仅 pty）；metrics 委托 runtime。
- `server/src/runtime/Monitor.js` → 移入 runtime provider。
- `server/src/db/schema.js` + `server/src/db/index.js`：新增 deployments 表（及可选 runtimes）；auto-migrate；默认 agent 数据不变。
- `server/src/auth/index.js`：不变（Vault 仍由 control 管理）。
- 前端：Console 增加 Preview 相关状态与调用（具体 UI 严格遵循 Designs.md）；AgentConsole / 终端头可加 Preview 状态徽章。

**红线**：
- 任何非 `Local*` 文件/函数中出现 `fs.` 直接操作 workspace 目录 → 必须重构。
- 假设 `ptyProcess` 一定是本地 node-pty → 必须通过 interface。
- 在 server 启动时直接绑定本地端口作为用户预览 → 必须走 Deployment + Gateway。

## 9. 推荐演进步骤（团队对齐执行顺序）

1. **抽象层**（不改行为）：定义 RuntimeExecutor / FsAdapter；把现有 Local 逻辑封装；workspace API 内部委托；SessionManager 支持 handle 泛化。保证 `npm run dev` 启动本地仍完全可用。
2. **Schema + API**：加 deployments 表与基础 CRUD API（preview 为主）；project 增加 runtime 相关字段（向后兼容）。
3. **Console 骨架**：在 terminal 头或右面板增加 Preview 入口（状态、URL 展示、操作按钮），调用新 API。UI 细节对齐 Designs.md。
4. **Local Preview 模拟**（可选）：在 Local provider 内支持“start preview port”，用 control proxy 暴露 `http://localhost:3000/preview/...` 作为过渡。
5. **真实 Provider**：实现第一个云/容器 provider（如本地 Docker 模拟完整云路径，或接 K8s）。此时 Local 仅用于纯单机无容器开发。
6. **Gateway 与 URL**：生产级子域名 + 反代；支持 iframe 预览与外部打开。
7. **Git 集成 & Skill**：workspaceRef 支持 git；引入 `.agents/` 目录（preview.skill、deploy.skill）供 Agent 发现启动契约。
8. **清理 & 强化**：移除遗留直接 FS 路径；加资源限额、TTL、审计；多实例支持（Session bridge 外置或 sticky session）。

每个步骤必须更新本文档 + 验证 Local 路径 + 云模拟路径均通过。

## 10. 非目标（当前阶段）

- 完整的多阶段 CI/CD pipeline（可由外部 GitHub Actions 等触发平台 API）。
- 跨云多 region 智能调度。
- Agent 直接操作生产环境（preview/staging 必须隔离）。
- 细粒度权限（RBAC 细化）与计费。

## 11. 开发对齐要求

- **必读**：实现或评审涉及 Runtime、Executor、workspace、session 启动、文件 API、preview/deployment 的代码前，必须完整阅读本文 + Designs.md。
- **本地开发规范**：默认使用 Local provider；任何直接 FS/PTY 代码仅允许出现在 `Local*` 实现文件内，并加注释说明“仅 Local 有效”。
- **接口优先**：新增执行相关能力先定义/扩展 interface，再实现 Local + 至少一个模拟远程 stub（便于测试）。
- **文档同步**：架构决策变更、provider 新增、schema 演进，必须同步更新本文档。
- **测试**：关键流程（start session、workspace ls/read、preview deploy）需同时覆盖 Local 与 stub 远程路径。
- **UI 约束**：Console 任何新面板、按钮、状态展示必须先在 Designs.md 中定义或获得对齐；本文只描述数据模型与 API 契约。

本文与 `docs/Designs.md`、`docs/agents.md` 共同构成团队对齐的三个核心文档。README.md 引用路径以它们为准。

---

*版本：v1（2026-06 初始目标架构）*  
*维护：架构变更需 PR + 更新本文 + 团队 review。*
