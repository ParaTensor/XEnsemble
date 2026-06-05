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
- **可演进**：支持多种 Runtime Provider（K8s、Docker、本地 SSH、Cloudflare Sandbox 等）；Workspace 支持外部 Git provider 作为源码事实来源，并由平台维护 repo snapshot / session checkpoint。

## 2. 当前状态（MVP → v2 抽象层）

- 控制面与执行面仍**同机 colocate**；`RuntimeService` 单飞 + default runtime 持久化；执行经四组 adapter。
- **Local provider（完整本地路径）**：`LocalPreviewAdapter` 按 `.agents/preview.json` 或 `package.json` scripts 起子进程；**Gateway** `GET/WS /preview/:deploymentId/*`（`http-proxy`，Bearer 或 `access_token`）；`preview/lifecycle.js` TTL 与重启对账。
- **Console Preview（步骤 3）**：`PreviewPanel` — Deploy / Stop / Restart / Embed / Open / TTL。
- **Deployments API**：CRUD + start/stop + `POST /api/v1/projects/:id/preview` 一键部署；`public_url` 指向 control plane Gateway（非裸绑 workspace 端口）。
- **Session**：`runtime_id / stream_ref / recoverable` 已落库；scrollback 仍控制面内存，`attachSession` 未实现。
- **尚未实现（步骤 5+）**：Docker/K8s provider、生产子域名 Gateway、Git provider 同步、repo baseline snapshot 预热、session checkpoint 恢复、session bridge 外置/多实例、contract test 套件自动化。

架构已是 B/S 服务端驱动（前端仅 Console + WS 终端），并已完成本地执行路径的 adapter 化；后续重点是补 Preview/Deployment 一等资源、真实 provider、Gateway 与 session 可恢复能力。

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
  └─ DB (metadata: users, projects, runtimes, sessions, agents, secrets, deployments, events)
   │
   ├─ Runtime Adapters
   │     ▲
   │     │  RuntimeProvider / ExecAdapter / FsAdapter / PreviewAdapter
   ▼     │
Execution Plane (pluggable providers)
  ├─ LocalRuntimeProvider + LocalExecAdapter + LocalFsAdapter + LocalPreviewAdapter
  ├─ Docker provider adapters
  ├─ K8s provider adapters
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
Storage Layer (volumes / git / object snapshots) + Preview Ingress (public URLs)
```

- **Control Plane**：无状态或弱状态（除内存 bridge）；可多实例（需外部化 Session 桥接状态或 sticky）。
- **Execution Plane**：强状态（PTY、FS）。Provider 负责生命周期（provision、attach、destroy）。
- **Preview / Deployment Plane**：与 Agent Shell 解耦但可共用 Runtime 资源。负责用户应用的构建、运行、端口注册、URL 分配。独立于 agent 的“shell session”。
- **Gateway**：将 preview public URL 反向代理到 runtime 内部端口。初期可用 control plane 的 http-proxy 实现；生产推荐独立 ingress + wildcard DNS。
- **Lifecycle / Event Manager**：统一处理 runtime idle TTL、preview TTL、停止/销毁、日志保留、资源回收与状态事件；避免各 provider 分散实现回收逻辑。

#### Runtime 基数（project ↔ runtime 关系）

一个 project **可对应多个 runtime**（1:N），而非 1:1：

- agent shell / dev preview 通常复用 project 的**默认 runtime**；
- staging / prod 部署使用**隔离的 runtime 或同一 runtime 的不同 profile**（见 5.3）。

因此 runtime 是**一等实体**（独立表，见第 4 节），不可降级为 project 的单值字段。project 仅记录"默认 runtime 指针"用于快速 attach；其余 runtime 通过 `runtimes.project_id` 关联。

#### Project Dev Environment（repo 维护构建环境）

面向真实工程项目，XEnsemble 不应只维护一个可读写目录，而应维护 **Project Dev Environment**：

- **外部 Git provider 是源码事实来源**：优先集成 GitHub / GitLab / 企业 Git，不自研 Git server；项目仅保存 provider、repo URL、默认分支、installation/token 引用与 lastSyncSha。
- **Repo baseline snapshot**：平台按计划任务或 webhook 从默认分支同步，安装依赖、预热 build/cache，并保存为 `repo_snapshots`；agent session 从最新 snapshot 派生，避免每次从空目录 clone/install。
- **Workspace checkpoint**：agent 修改、测试、预览后的会话状态可保存为 `workspace_checkpoints`；用户 follow-up prompt 时可从上一次 checkpoint 恢复。
- **Dev environment profile**：项目的工程服务契约（app/dev command、端口、Postgres/Redis 等依赖服务、lint/test/build/preview 命令）由 `.agents/dev.env.json`、`.agents/preview.json`、`package.json`、`docker-compose.yml`、`.devcontainer` 或控制面配置解析/覆盖。

Git 负责可追踪源码历史；repo snapshot 负责快速启动基线；workspace checkpoint 负责 agent 会话连续性；deployment revision 必须指向 gitSha / snapshotId / checkpointId 中的一个确定对象。

#### 组件职责边界（避免执行接口成为"上帝接口"）

执行面能力按**接口隔离**拆分，provider 可按需组合实现（见 3.1）：

- **RuntimeProvider**：runtime 生命周期（provision / attach / destroy / metrics）。
- **ExecAdapter**：交互式 PTY (`spawn`) 与短任务 (`exec`)。
- **FsAdapter**：受控文件读写（list / read，未来 write）。
- **PreviewAdapter**：preview 进程的 start / stop / status。

**PreviewManager** 与 **Lifecycle / Event Manager** 是控制面侧的编排组件，**不属于 provider 接口**——它们调用上述 adapter 完成跨 provider 的状态机与回收逻辑。3.1 的契约据此分组。

### 3.1 执行面接口契约（按能力隔离）

接口按职责拆为四组，provider 按需实现对应能力（Local 实现全部；远程 provider 可分能力上线）。所有 provider 必须实现**同一组语义**，而不仅是复用方法名。

**RuntimeProvider（生命周期）**
- `ensureReady(project, { runtimeId? })`：幂等；可重复调用；返回 runtime ref 与 workspace 逻辑根路径；必须有超时与明确错误码。**必须并发安全**：对同一 (project, runtimeId) 的并发调用须经单飞/锁合并为一次真实 provision，禁止重复创建容器（见下"并发与幂等")。
- `attach(runtimeRef)`：重连到已存在 runtime。
- `attachSession(sessionId | streamRef)`：重连到 runtime 内已存在的 PTY stream；返回 scrollback、后续输出流与 `recoverable` 标记。
- `destroy(runtimeRef)`：幂等销毁。
- `metrics(runtimeRef)`：返回 runtime / preview 资源指标；不可依赖 control plane 本机 `ps`。

**ExecAdapter（命令执行）**
- `spawn(cmd, args, env, options)`：用于交互式 PTY / agent session；返回可 resize、可 close、可订阅 stdout/stderr 的 stream handle；handle 必须支持 reattach（见 3.2）。
- `exec(cmd, args, env, options)`：用于短任务、探测、preview build/start 辅助命令；必须支持超时、取消、退出码、stdout/stderr 上限。

**FsAdapter（受控文件）**
- `fsList(path)` / `fsRead(path)`：只接受 project 内相对路径；provider 侧强制路径 jail；返回结构化结果，禁止返回宿主机绝对路径。（未来 `fsWrite` 须经 runtime 授权。）

**PreviewAdapter（预览进程）**
- `startPreview(project, contract)` / `stopPreview(deployment)`：必须幂等；返回 internal target、端口、健康检查状态与日志引用。

> RuntimeProvider / ExecAdapter / FsAdapter / PreviewAdapter 是**执行面接口**；PreviewManager 与 Lifecycle/Event Manager 是**控制面编排组件**，调用这些 adapter，不在 provider 实现范围内（见第 3 节职责边界）。

**并发与幂等（强制）**
- 所有 provision 类操作（`ensureReady`、`startPreview`）须以 (project, runtimeId/deploymentId) 为键做**单飞（singleflight）**：并发请求复用同一进行中的 promise，且最终状态以持久化记录为准。
- 幂等不等于并发安全：实现必须显式处理"两个 `session/start` 或 session + preview 同时触发同一 project"的竞态，避免重复容器/重复端口绑定。

**错误码映射**
接口错误需区分并映射为稳定 API 响应：

| 错误类别 | 建议 HTTP |
|---|---|
| 鉴权失败 | 401 / 403 |
| 资源不存在 | 404 |
| runtime 未就绪 | 409 / 503 |
| 路径越界 | 403 |
| 命令超时 | 504 |
| 资源超限（tier/配额） | 429 |
| provider 不可用 | 502 / 503 |

### 3.2 Session 多实例策略

MVP 可使用 sticky session 保证同一 terminal WebSocket 落到持有 bridge 的 control plane 实例；生产必须外部化 bridge routing（如 Redis / NATS / provider stream endpoint），避免 server 滚动发布或横向扩容导致活跃终端不可恢复。

`SessionManager` 只保存 bridge handle，不拥有本地 PTY 事实状态。Session 重连应优先按 `sessionId` / `streamRef` attach 到 runtime stream；如果 provider 不支持 attach，需要明确标记 session 为不可恢复并返回可解释错误。

**Scrollback（终端历史）归属（强制）**：终端可重连的前提是 scrollback 不丢。因此 scrollback 的**事实来源在 runtime 侧**（runtime 内 PTY 多路复用层 / sidecar 维护 ring buffer），control plane 仅持**易失的转发缓存**用于降低首屏延迟，不得作为唯一来源。

- 当前 MVP（Local）把 `history` 存在 `SessionManager` 进程内存（`session.history`），server 重启即丢——这是已知局限，仅适用于单机 dev。
- 目标态：重连时由 control plane 调用 `attachSession(sessionId | streamRef)` 从 runtime 拉取 scrollback 与后续流，使"控制面滚动发布/横向扩容/重启"对活跃终端透明。
- provider 不支持 scrollback 持久化时，必须在 attach 响应中标记 `recoverable=false`，由 Console 提示用户。

## 4. 核心领域模型（建议扩展 schema）

现有表（保持兼容）：
- users, secrets (encrypted), agents (注册表), projects (id, userId, name, **serverPath** → 演进为 workspaceRef, defaultRuntimeId, repo*), sessions (id, userId, projectId, agentId, cwd, status, createdAt)

新增 / 演进：

- **runtimes**（**一等实体，独立表**；不再降级为 project 单值字段，因为 project ↔ runtime 为 1:N，见第 3 节）：
  - id
  - project_id（FK；一个 project 可有多条）
  - provider: 'local' | 'docker' | 'k8s' | ...
  - runtime_ref: provider-specific id / pod / container / sandbox_id
  - role: 'default' | 'staging' | 'prod'（区分 agent/dev 复用的默认 runtime 与隔离部署 runtime）
  - status, endpoint (internal), specs (cpu/mem)
  - createdAt, updatedAt
  - project 侧保留 `default_runtime_id` 指针，便于快速 attach。

- **deployments**（核心，用于 preview 看效果）：
  - id, **userId**（FK；与 projectId 双重作用域，便于多租户隔离查询与鉴权，不仅靠 project join）
  - projectId, **runtimeId**（FK → runtimes）
  - kind: 'preview' | 'staging' | 'prod'
  - status: 'pending' | 'building' | 'running' | 'failed' | 'stopped' | 'expired'
  - publicUrl: 'https://preview-xxx.yourdomain'
  - internalRef: runtime + port / service name
  - revision: gitSha | snapshotId | checkpointId（**禁止仅用模糊的 'latest'**，见第 6 节）
  - expiresAt (preview TTL), createdAt, updatedAt
  - createdBy, stoppedBy, lastErrorCode, lastErrorMessage
  - resourceTier, region
  - buildLog / runtimeLog (可选外链或截断存储)

- **events**（审计 / 前端订阅事实来源；3、5.4 引用的 Lifecycle/Event Manager 写入此表）：
  - id, userId, projectId
  - subjectType: 'runtime' | 'deployment' | 'session'
  - subjectId
  - type: 'created' | 'ready' | 'failed' | 'stopped' | 'expired' | 'restarted' | ...
  - data (JSON：错误码、URL、revision 等)
  - createdAt
  - 用途：审计、排障、Console 状态推送（轮询或 WS/SSE）。若初期决定事件只走日志不落库，须在本节显式声明。

projects.serverPath 在 Local provider 下仍可直接映射；云 provider 下为逻辑 ref，实际路径在 runtime 内。

- **sessions**（演进字段，用于 stream reattach）：
  - runtimeId（FK → runtimes）
  - streamRef（provider 内 PTY stream id / mux channel id）
  - recoverable: boolean（provider 是否支持 attach + scrollback）
  - lastAttachAt, endedAt, exitCode
  - deploymentSnapshot（可选；或仅通过 project 关联当前活跃 preview）

- **projects repo 字段**（不自建 Git server，先接外部 provider）：
  - repo_provider: 'github' | 'gitlab' | 'generic_git' | 'none'
  - repo_url, repo_default_branch, repo_installation_ref, repo_token_secret_ref
  - workspace_mode: 'local' | 'git' | 'snapshot'
  - last_sync_sha, last_snapshot_id, dev_profile_id

- **dev_environment_profiles**：
  - id, projectId, source: 'detected' | 'manual' | 'repo'
  - profileJson（服务、命令、端口、checks、preview 契约）
  - createdAt, updatedAt

- **repo_snapshots**：
  - id, projectId, gitSha, branch, status: 'pending' | 'building' | 'ready' | 'failed' | 'expired'
  - storageRef（provider snapshot id / object storage ref / local path）
  - buildLog, lastError, createdAt, updatedAt, expiresAt

- **workspace_checkpoints**：
  - id, projectId, sessionId, baseSnapshotId, status: 'pending' | 'ready' | 'failed' | 'expired'
  - storageRef, diffRef, gitSha, createdBy, createdAt, expiresAt
  - 用途：follow-up prompt 恢复、preview 确定 revision、PR 前验证。

## 5. 关键流程（对实现有约束）

### 5.1 启动 Agent Session（支持远程 Runtime）

1. `POST /api/v1/session/start`（agent_id + project_id）
2. Control 鉴权 → 取 project → 解析 `defaultRuntimeId` / runtime 记录 → 选择 `checkpointId` 或最新 `repoSnapshotId` → 调用 `runtime.provider.ensureReady(project, { runtimeId, checkpointId?, baseSnapshotId? })`（本地 mkdir 或云 provision/attach/restore）。
3. 取 user Secrets → `runtime.exec.spawn(cmd, args, envs, { cwd: runtimeWorkspacePath, ... })`
   - Local：由 `LocalExecAdapter` 封装 node-pty，返回 `StreamHandle`。
   - 远程：向 runtime 发起远程 exec 请求，返回可 reattach 的 stream handle（WS / multiplexed channel）。
4. `SessionManager.createSession(sessionId, streamHandle, agentId)`（泛化，不再只存 ptyProcess）。
5. 写 DB sessions（cwd 仍存逻辑路径；目标态同时写 `runtimeId / streamRef / recoverable`）。
6. Client 连 `ws://.../ws/v1/terminal?sessionId=...`
   - Control plane 接受 WS，**内部桥接** input → runtime stream，runtime output → client。
   - resize、metrics 通过 `StreamHandle` / runtime adapter 委托；scrollback 的事实来源在 runtime 侧，SessionManager 仅持易失缓存。
   - 协议**完全不变**。

### 5.2 Workspace 文件操作（必须走抽象）

- 现有 `/api/v1/workspace/files?project_id=` 与 `/file?project_id=&path=` **必须改为委托模式**：
  - 根据 project 解析当前 runtime。
  - 调用 `runtime.fsList(relativePath)` / `runtime.fsRead(path)`。
- Local 实现：保留原有 `workspace.js` 的 `resolveSafePath` + fs 逻辑（封装为 LocalFsAdapter）。
- 远程实现：runtime 暴露受控 FS 接口（推荐：轻量 sidecar HTTP 或通过已连接的 agent 执行 `ls`/`cat` 并结构化返回；或共享存储层由 control 直接安全读）。
- **禁止**在 server.js 或非 Local 模块直接 `fs.existsSync(project.serverPath)` 或 `fs.readdirSync`。
- 写操作：保持“仅 Agent 终端内完成”的产品约束；未来可加受控 write API（必须经 runtime 授权）。

远程 FS 主路径应优先使用 runtime sidecar / provider API / 共享存储接口；通过 agent shell 执行 `ls` / `cat` 仅允许作为调试或 fallback，不能成为稳定产品路径。

### 5.3 Preview 部署与“看效果”（云端核心路径）

1. 触发：Console 按钮（“Deploy Preview”）或 Agent 通过平台工具/API 调用（`requestPreview(projectId)`）。
2. Control 创建 `Deployment` 记录（kind=preview）。
3. `PreviewManager.deploy(project)`：
   - 确保 runtime 就绪。
   - 生成明确 revision：已提交代码用 gitSha；未提交工作区先生成 workspace checkpoint，并写入 `deployments.revision`，禁止以裸 `latest` 启动 preview。
   - 通过 runtime 执行“启动预览”契约：
     - 优先读项目内 `.agents/preview.skill.md` 或 `package.json` scripts（dev/start/build）。
     - 或平台约定的启动命令 + ready 探测（端口或日志匹配）。
   - 在 runtime 内启动用户应用进程（可为后台进程，非 agent PTY；或 agent 另开一个 PTY 跑 `npm run dev`）。
   - **端口必须显式声明**：来自 `.agents/preview` 契约或平台约定的单端口；端口扫描仅作为最后 fallback 且须记录告警，不能作为稳定产品路径（扫描既不可靠也有暴露非预期服务的安全风险）。
4. 分配/注册 public URL（子域名 + Gateway 路由规则）。
5. 更新 Deployment 状态 + publicUrl。
6. 返回给 Console。
7. Console 展示（遵 Designs.md）：状态徽章、URL（可点击/iframe）、刷新、重启、停止、TTL 倒计时。支持在预览页注入元素选择/错误上报（后期 Visual QA）。

Preview 状态必须由部署状态机驱动：`pending → building → running | failed | stopped | expired`。状态变化写入 deployments，并通过轮询或后续 WS/SSE 推送给 Console。

正式部署（staging/prod）流程类似，但：
- 使用隔离的 runtime 或同一 runtime 的不同 profile。
- 注入生产 Secrets（与 dev preview 隔离）。
- 无 TTL 或更长生命周期。
- 可能走外部 CI/CD 通道（平台仅触发）。

Preview 与 Agent Session **解耦**：可以没有活跃 agent session 时仍有 preview 运行；agent session 结束不自动杀 preview。

**Preview 重启与 Secrets**：因 preview 独立于 agent session，"重启"按钮触发时通常**无活跃 session**可借用其注入的环境。重启路径必须由 **PreviewManager 在重启时从 Vault 按 deployment 的 secret scope 重新拉取并注入**到新进程；这与第 7 节"运行中不持久化 secrets"不冲突——control plane 仅持有 Vault 引用、按需取密注入，runtime 内不落盘、不写入 deployment record / build log。

### 5.4 Runtime 生命周期

- Project 创建时：可选立即 provision runtime（或 lazy：首次 session/preview 时）。
- Runtime 停止/销毁：显式 API 或闲置 TTL（preview 更激进）。
- 迁移/重建：保留 workspace 卷，换新 runtime 容器，重新 attach。
- Lifecycle / Event Manager 统一扫描并处理过期 preview、idle runtime、僵尸进程、日志保留与资源释放。
- Runtime / Deployment 关键状态变化应记录事件（created、ready、failed、stopped、expired、restarted），便于审计、排障和前端订阅。

## 6. 存储策略

- **首选外部 Git provider 作为源码事实来源**：project 记录 repo URL + branch + lastSyncSha；Runtime attach 时基于 repo snapshot / checkpoint restore，而不是每次直接 clone/pull。
- **Repo snapshot 是快速启动基线**：定时任务或 webhook 触发 clone/install/build/cache warmup，保存 filesystem snapshot；snapshot 可以落在 provider 原生 snapshot、对象存储或 Local 目录中。
- **Workspace checkpoint 是 agent 会话状态**：agent 修改后的工作区、依赖变化、测试产物与 diff 引用可 checkpoint；follow-up prompt、preview、PR 验证均应可指向 checkpoint。
- **卷持久化是运行时工作副本**：K8s PVC / 云盘 per project/runtime。Local 下映射为目录。runtime 重建优先复用卷；跨 provider 迁移时以 Git + checkpoint / snapshot 恢复。
- **对象存储快照**：用于备份/回滚/跨 provider 迁移。
- 当前 `WORKSPACE_ROOT` 仅 LocalProvider 内部实现细节；云场景下 server 本地不应有完整 workspace 副本（除缓存）。

一致性原则：Git 负责可追踪版本，runtime 卷负责未提交工作区，snapshot/checkpoint 负责灾备与迁移。Preview 的 `revision` 必须明确指向 gitSha、snapshotId 或当前工作区 checkpoint，不能只依赖模糊的 `'latest'`。

## 7. 安全、隔离、运维

- Runtime 必须以最小权限运行；Secrets 仅启动时注入，运行中不持久化在镜像。
- 路径 jail、命令白名单在 runtime 侧或 adapter 侧强制。
- Preview URL 保护：短期 token + Console 登录态校验；或 project 级共享密钥。
- Preview token 必须绑定 deploymentId，可设置过期时间；Gateway 必须校验 Host header、token / 登录态、project 访问权限，并支持公开访问与租户内访问两种模式。
- Gateway 需支持 HTTP、WebSocket、SSE 的代理语义；iframe 嵌入策略、CSP 与外链访问策略需与 Designs.md 中的 Preview 展示保持一致。
- 资源：runtime spec 受 tier 限制；Preview 进程可单独限额。
- 可观测：metrics（现有 ps 逻辑 → runtime 提供）、日志聚合（terminal 历史 + preview build/runtime log）。
- 多租户：project/user 维度严格隔离 runtime；control plane 仅持有 ref，不直接操作远端 FS/PTY。
- Secrets 按作用域注入：agent session、dev preview、staging/prod 使用不同 scope；不得写入镜像、workspace、deployment record、build log 或 terminal history。
- **按需取密、可重复注入**：control plane 仅持有 Vault 引用，不缓存明文。preview/部署"重启"等无活跃 session 的路径，由 PreviewManager 在每次启动时从 Vault 按 scope 重新拉取注入（见 5.3）；runtime 内只在进程环境中存在、不落盘。

## 8. 实现映射与约束（当前代码基线）

必须改动/抽象的位置（对齐时逐一检查）：

- `server/src/runtime/interfaces.js`：定义 `RuntimeProvider / ExecAdapter / FsAdapter / PreviewAdapter / StreamHandle`。
- `server/src/runtime/registry.js`：按配置注入 provider adapters（当前仅 `local`）。
- `server/src/runtime/RuntimeService.js`：`ensureProjectRuntime` 单飞、default runtime 创建/持久化、workspace 路径解析。
- `server/src/runtime/singleflight.js`：provision 并发合并。
- `server/src/db/backfillRuntimes.js`：历史 project 回填 default runtime。
- `server/src/deployments/DeploymentService.js`：deployments CRUD 与 preview start/stop 状态机。
- `server/src/events/recordEvent.js`：写入 `events` 审计表。
- `server/src/runtime/localPreviewRegistry.js`、`previewContract.js`：Local preview 进程与启动契约。
- `server/src/preview/gateway.js`、`preview/lifecycle.js`：反代与 TTL/重启对账。
- `client/src/components/PreviewPanel.jsx`：Console Preview UI（对齐 Designs.md Preview 节）。
- `server/src/runtime/LocalExecAdapter.js`：Local node-pty 实现；任何 node-pty / 本地进程假设只允许在 Local 实现内部。
- `server/src/runtime/LocalRuntimeProvider.js`：Local workspace 生命周期。
- `server/src/runtime/LocalFsAdapter.js`：Local 受控 FS 读操作。
- `server/src/runtime/LocalPreviewAdapter.js`：Local preview 占位；后续实现须走 Deployment + Gateway 路径。
- `server/src/runtime/Executor.js`：仅保留向后兼容 shim，新代码禁止继续依赖。
- `server/src/workspace.js`：作为 Local provider 内部工具；`createProjectDirectory` 仅 Local 有效。
- `server/src/server.js`：
  - session/start 流程必须走 `runtime.provider.ensureReady()` + `runtime.exec.spawn()`。
  - workspace/* 路由必须走 `runtime.fs.*`。
  - 新增 `/api/v1/deployments`（CRUD + startPreview/stopPreview for project）。
  - WS terminal 保持协议不变，内部 bridge 仅依赖 `StreamHandle`。
- `server/src/session/SessionManager.js`：只保存 bridge handle 与易失缓存，不假设本地 PTY。
- `server/src/runtime/Monitor.js`：仅允许 Local 实现内部使用；非 Local metrics 必须由 runtime/provider 提供。
- `server/src/repositories/RepositoryEnvironmentService.js`：repo 绑定、dev profile、repo snapshot、workspace checkpoint 元数据服务；Git provider / snapshot 真实执行后续接入。
- `server/src/db/schema.js` + `server/src/db/index.js`：维护 `runtimes / deployments / events / dev_environment_profiles / repo_snapshots / workspace_checkpoints` 与 sessions reattach 字段；auto-migrate；默认 agent 数据不变。
- `server/src/auth/index.js`：不变（Vault 仍由 control 管理）。
- 前端：Console 增加 Preview 相关状态与调用（具体 UI 严格遵循 Designs.md）；AgentConsole / 终端头可加 Preview 状态徽章。

**红线**：
- 任何非 `Local*` 文件/函数中出现 `fs.` 直接操作 workspace 目录 → 必须重构。
- 假设 `ptyProcess` 一定是本地 node-pty → 必须通过 interface。
- 在 server 启动时**绕过 Deployment/Gateway** 直接绑定本地端口作为用户预览 → 必须走 Deployment + Gateway。（注：经 PreviewAdapter + Deployment 记录、再由 control proxy 暴露的 Local dev preview 不算违例，见第 9 节步骤 4。）

## 9. 推荐演进步骤（团队对齐执行顺序）

1. **抽象层**（✅）：provider adapters + `StreamHandle` + SessionManager 泛化。
2. **Schema + API**（✅）：`runtimes / deployments / events`、backfill、`RuntimeService`、deployments CRUD。
3. **Console 骨架**（✅）：`PreviewPanel` + Designs.md Preview 节。
4. **Local Preview + Gateway**（✅）：`LocalPreviewAdapter` + `/preview/:id` 反代 + lifecycle TTL；须经 Deployment 记录（非红线裸绑端口）。
5. **真实 Provider**：实现第一个云/容器 provider（如本地 Docker 模拟完整云路径，或接 K8s）。此时 Local 仅用于纯单机无容器开发。
6. **Gateway 与 URL**：生产级子域名 + 反代；支持 iframe 预览与外部打开。
7. **Git 集成 & Dev Environment**：接 GitHub/GitLab App；workspaceRef 支持 repo snapshot/checkpoint；引入 `.agents/` 目录（dev.env、preview、deploy）供 Agent 发现启动契约。
8. **清理 & 强化**：移除遗留直接 FS 路径；加资源限额、TTL、审计；多实例支持（Session bridge 外置或 sticky session）。

每个步骤必须更新本文档 + 验证 Local 路径 + 云模拟路径均通过。

每个 Runtime Provider 必须通过同一套 contract tests：start session、terminal resize/close、workspace list/read、preview deploy/stop、TTL cleanup、错误码映射。

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

*版本：v2 草案（2026-06；在 v1 目标架构上修订：runtime 一等实体/1:N、接口按能力隔离、provision 单飞、scrollback 归属 runtime、events 审计表、deployments 增 userId/runtimeId、preview 端口显式声明与重启取密、Local preview 非红线澄清）*  
*维护：架构变更需 PR + 更新本文 + 团队 review。*
