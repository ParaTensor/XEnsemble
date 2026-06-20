# XEnsemble 生产架构设计

> 状态：设计草案  
> 日期：2026-06-19  
> 适用范围：`server/` 控制面、`gateway/` LLM Gateway、`desktop/` Desktop Client、`client/` Web 管理面、Runtime Provider  

---

## 1. 设计目标

将 XEnsemble 从“带 Web Console 的 Local MVP”演进为**以后台服务为核心、Desktop Client 为主入口**的生产架构：

1. **不再支持在线 Web Coding**：普通用户不再通过浏览器进行代码编辑、Web Terminal 交互、iframe Preview 等在线 Coding 操作，降低前端维护成本。
2. **Client-Server 模式**：XEnsemble Server 作为独立后台服务运行，用户主要通过 **XEnsemble Desktop Client**（桌面原生应用）连接并使用。
3. **保留 Web 管理面**：现有 `client/` Web UI 继续保留，作为 **Admin 管理台、平台状态页、用户登录/注册入口**（可选）。普通用户的 Coding 工作流迁移到 Desktop Client。
4. **执行面本地执行（第一阶段）**：为降低部署复杂度，生产第一阶段**使用本地执行方式**（Local Runtime Provider），即 Agent / Preview 进程直接运行在 Server 所在机器上；控制面仍通过 `RuntimeProvider` 抽象管理生命周期，未来可平滑替换为 Docker/K8s。
5. **生产就绪默认**：强制安全密钥、Refresh Token、进程级隔离、Secrets 不落地、控制面可水平扩展。

---

## 2. 核心约束

| 约束 | 说明 |
|------|------|
| Web 不作为用户 Coding 入口 | 普通用户的终端、文件编辑、iframe 预览等操作不在 Web 端提供；后台 Coding 类 API 优先面向 Desktop Client。 |
| Desktop Client 是主入口 | 用户的日常交互（登录、启动 Agent、查看终端、管理项目/Agent、触发 Preview）默认通过 Desktop Client 完成。 |
| Web 管理面保留 | Admin 管理、用户/Agent/平台配置、状态展示等仍可通过 `client/` Web 管理台操作。 |
| 执行面本地执行 | 第一阶段 Agent/Preview 在 Server 本机运行；通过抽象层封装，未来可替换为 Docker/K8s。 |
| 向后兼容协议 | 现有 REST/WS 消息格式尽量保留，仅在鉴权层增强（WS 也带 token）。 |
| 执行面抽象不变 | 继续沿用 `RuntimeProvider / ExecAdapter / FsAdapter / PreviewAdapter` 四层接口。 |

---

## 3. 方案选型

### 方案 A：Desktop Client 内嵌本地后端
Desktop Client 打包本地 Node.js 运行时，本机启动控制面 + Local Runtime。

- **优点**：零服务器运维，开箱即用。
- **缺点**：无法团队共享、执行面仍是本机、Secrets 分散在客户端。
- **结论**：保留为开发/个人模式，**不作为生产主方案**。

### 方案 B：Self-Hosted Server + 本地执行（推荐，第一阶段）
每个团队/企业在服务器上部署一个 XEnsemble Server，使用 **Local Runtime Provider** 直接在本机运行 Agent/Preview；Desktop Client 远程连接，Web 管理面保留。

- **优点**：部署简单、无需 Docker/K8s、团队共享配置、运维可控、架构已为未来容器化预留扩展点。
- **缺点**：Agent 代码与 Server 控制面在同一台机器运行，隔离性弱于容器；需通过 OS 用户/进程/目录 jail 加固。
- **结论**：**本次生产架构第一阶段的基线方案**。

### 方案 C：Server + Docker/K8s Runtime（第二阶段）
控制面不变，Runtime Provider 替换为 Docker 或 K8s，实现容器级隔离。

- **优点**：强隔离、资源限额、弹性伸缩。
- **缺点**：需要容器基础设施与运维能力。
- **结论**：**第一阶段完成后演进**。

### 方案 D：托管多租户云服务
多租户控制面 + K8s Runtime Provider + 计费 + 子域名 Gateway。

- **优点**：规模化、按需付费。
- **缺点**：复杂度高，需要强租户隔离、网络策略、计费系统。
- **结论**：远期演进方向，本次不实现。

---

## 4. 总体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         XEnsemble Desktop Client                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐             │
│  │ 登录 / 设置  │  │ 项目管理     │  │ Agent / Session 管理 │             │
│  └─────────────┘  └─────────────┘  └─────────────────────┘             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐             │
│  │ 本地编辑器   │  │ 终端 (xterm) │  │ 系统浏览器预览       │             │
│  └─────────────┘  └─────────────┘  └─────────────────────┘             │
└───────────────────┬─────────────────────────────────────────────────────┘
                    │ HTTPS / WSS
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       XEnsemble Server（控制面 + 执行面）                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐             │
│  │ Auth / Policy │ │ SessionManager│ │ RuntimeService       │             │
│  │ JWT + Refresh │ │ (bridge only) │ │ (distributed lock)   │             │
│  └──────────────┘ └──────────────┘ └──────────────────────┘             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐             │
│  │ Deployment   │ │ LLM Proxy    │ │ Events / Audit       │             │
│  │ Service      │ │ /api/v1/llm  │ │                      │             │
│  └──────────────┘ └──────────────┘ └──────────────────────┘             │
│  ┌──────────────┐ ┌──────────────┐                                      │
│  │ Admin API    │ │ Preview      │                                      │
│  │ /admin/*     │ │ Gateway      │                                      │
│  └──────────────┘ └──────────────┘                                      │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    │ Local Runtime Provider
                    ▼
        ┌─────────────────────┐
        │  Agent PTY / Preview │  (运行在同一台 Server 上)
        │  Local FS / Process  │
        └─────────────────────┘

┌─────────────────────────────────┐
│  client/ Web 管理面（保留）      │
│  Admin / 平台设置 / 状态展示      │
└─────────────────────────────────┘
```

---

## 5. 组件职责

### 5.1 Desktop Client

- **身份**：原生桌面应用（推荐 Electron / Tauri / 独立原生框架）。本项目代码位于 `desktop/`。
- **职责**：
  - 登录后台，保存 Refresh Token 到系统钥匙串，管理 Access Token 生命周期。
  - 展示项目、Agent、Session、Deployment 列表与管理界面（普通用户主界面）。
  - 嵌入终端组件（xterm.js 等）通过 WSS 连接后台 `/ws/v1/terminal`。
  - 本地编辑器集成：调用用户本机 VS Code / Cursor / 其他编辑器打开 workspace；不内嵌代码编辑器。
  - 预览：收到 `publicUrl` 后调用系统默认浏览器打开；不内嵌 iframe 预览。
  - 文件同步：通过 SFTP/SSHFS/Git 或专用同步协议把 Server 端 workspace 映射到本地目录（可选，第一阶段可要求用户直接用 Git）。
- **禁止**：内嵌 Web IDE、在 Client 里直接读写后端 FS（必须通过 API/FS 适配器）。

### 5.2 Web 管理面（`client/`）

- **身份**：保留的浏览器端 React 应用。
- **职责**：
  - **Admin 管理台**：用户/配额/Agent 授权/平台设置/Gateway 配置。
  - **状态展示**：项目列表、Session 状态、Deployment 状态、事件审计。
  - **登录/注册入口**：可作为用户首次获取账号的入口，但 Coding 主流程跳转到 Desktop Client。
- **限制**：
  - 不再提供 Web Terminal（普通用户）。
  - 不再提供 iframe Preview。
  - 不提供浏览器内代码编辑器。
- **后续演进**：Admin 能力未来也可下沉到 Desktop Client；Web 管理面逐步转型为纯运营/运维后台。

### 5.3 控制面（XEnsemble Server）

基于现有 Fastify 服务，剥离面向普通用户的 Web Coding 功能，保留并强化以下模块：

| 模块 | 生产化调整 |
|------|------------|
| `auth/index.js` | 强制 `JWT_SECRET`/`ENCRYPTION_KEY`；引入 Refresh Token；PBKDF2 升级到 ≥210k 次或 Argon2id。 |
| `auth/PolicyService.js` | 继续执行 quota / agent grant；增加 `checkUserActive` 全局钩子。 |
| `auth/hooks.js` | `authenticate` 校验 Access Token；新增 `requireActive`、`requireAdmin`。 |
| `runtime/*` | 保留接口；第一阶段使用 Local Provider；所有本地 FS/PTY 假设严格限制在 `Local*` 文件内。 |
| `session/SessionManager.js` | 仍只保存 bridge handle；scrollback 事实来源为 Runtime 侧（本地可由 sidecar/文件缓存实现）。 |
| `deployments/DeploymentService.js` | 状态机不变；revision 必须指向真实 `gitSha` / `snapshotId` / `checkpointId`。 |
| `llm/*` | 保留 session token 反代；移除全局 rebind 锁，改为 per-agent gateway key 或 header 路由。 |
| `gateway/*` | UniGateway 作为本地进程或外部上游；admin token 强制配置。 |
| `preview/gateway.js` | 代理预览流量；使用 deployment-scoped token 并校验 `Host`/用户状态。 |
| `events/recordEvent.js` | 保留审计。 |

### 5.4 执行面（Runtime Provider）

第一阶段使用 **Local Runtime Provider**，即 Agent / Preview 直接运行在 Server 本机：

- **LocalRuntimeProvider**：确保 workspace 目录存在；管理本地运行环境生命周期。
- **LocalExecAdapter**：基于 `node-pty` 提供 `spawn`；实现 `exec` 用于短任务/构建探测。
- **LocalFsAdapter**：受控文件列表/读取，严格路径 jail，禁止返回宿主机绝对路径；解析 symlink 防止越界。
- **LocalPreviewAdapter**：在本地启动 preview 进程，声明端口，注册到 Gateway。
- **存储**：workspace 目录位于 Server 本地文件系统；通过 Git 或对象存储实现 snapshot/checkpoint。

**本地执行的安全边界**：
- Agent/Preview 以低权限 OS 用户运行（与 Server 进程不同用户）。
- 使用 `chroot`/目录 jail / SELinux/AppArmor（可选）限制可访问路径。
- 通过 cgroups/systemd 限制 CPU/内存/进程数。
- Secrets 仅注入环境变量，不写入 workspace。

Docker/K8s Provider 作为第二阶段实现，通过同一组接口替换 Local Provider。

### 5.5 LLM Gateway

- `gateway/` Rust 二进制继续作为可选内置 LLM 路由。
- 生产推荐以外部 UniGateway（`LLM_GATEWAY_UPSTREAM_URL`）运行，控制面只负责 session token 鉴权与转发。
- Desktop Client 不直接连接 UniGateway。

---

## 6. 通信协议

### 6.1 认证

- **登录**：`POST /api/v1/auth/login` 返回 `{ access_token, refresh_token, user, quotas }`。
- **刷新**：`POST /api/v1/auth/refresh` 用 Refresh Token 换取新的 Access Token。
- **Access Token**：短期（如 15 分钟），用于 API/WS。
- **Refresh Token**：长期（如 30 天），存储于 `refresh_tokens` 表，支持撤销与设备绑定。
- Desktop Client 使用系统钥匙串保存 Refresh Token。

### 6.2 REST API

保留并加固现有接口：

- `/api/v1/auth/*`
- `/api/v1/admin/*`（Web 管理面与 Desktop Client 共用）
- `/api/v1/projects/*`
- `/api/v1/sessions/*`
- `/api/v1/deployments/*`
- `/api/v1/runtimes/*`
- `/api/v1/secrets`
- `/api/v1/agents`（按授权过滤）
- `/api/v1/llm/*`（Agent 使用，非 Client 直接调用）
- `/api/v1/workspace/*`（保留受控文件列表/读取，供 Desktop Client 文件浏览器与 Web 管理面使用，不用于编辑）

**移除/禁用**：
- 浏览器内代码编辑器相关接口（如有）；
- Web 端面向普通用户的 Web Terminal 入口（Admin 调试场景可单独控制）；
- Web 端 iframe Preview；
- 允许 `origin: '*'` 的 CORS；改为只允许配置的 Web 管理面 origin 与 Desktop Client origin。

### 6.3 WebSocket 终端

- 路径：`/ws/v1/terminal?sessionId=...&access_token=...`
- 必须携带 Access Token；后台校验 token、session 归属与 `status === 'running'`。
- 消息格式与现有协议保持一致。
- HTTP(SSE+POST) 回退保留，供企业防火墙环境使用。
- Web 管理面不再默认暴露 Web Terminal；仅 Desktop Client 使用。

### 6.4 Preview 访问

- Preview URL 形如 `https://<server>/preview/<deploymentId>/...`。
- 使用 **deployment-scoped token**（短期、绑定 deploymentId），而非用户 JWT。
- Desktop Client 收到 URL 后调用系统浏览器打开；Web 管理面可展示“外部打开”链接，但不 iframe 嵌入。
- Gateway 校验 token、deployment 状态、用户 `active`、project 归属。

---

## 7. 数据模型调整

### 7.1 新增

- `refresh_tokens(id, user_id, token_hash, device_name, created_at, expires_at, revoked_at)`
- `runtime_providers` 配置表（可选，用于动态 provider 选择）

### 7.2 保留

- `users`（扩展 `status`、`last_login_at` 等）
- `user_quotas`、`user_agent_grants`
- `platform_settings`
- `projects`（保留 `default_runtime_id`，`server_path` 为 Local 执行的实际工作目录）
- `runtimes`（一等实体；第一阶段 provider = `local`）
- `sessions`（含 `runtime_id`、`stream_ref`、`recoverable`）
- `deployments`（状态机 + `revision`）
- `events`
- `repo_snapshots`、`workspace_checkpoints`、`dev_environment_profiles`

### 7.3 废弃/移除

- 浏览器内代码编辑器及其 API。
- Web 端面向普通用户的 Web Terminal（Admin 调试可保留开关）。
- Web 端 iframe Preview。
- 不再把 `scrollback` 作为控制面持久化字段；事实来源在 Runtime 侧（本地可用文件/ring-buffer 缓存）。
- 内存单飞/内存配额（替换为 Redis）。
- 硬编码 JWT/加密密钥回退。
- `trustProxy: true` 默认开启。
- CORS `origin: '*'`。

---

## 8. 安全与隔离

| 层面 | 要求 |
|------|------|
| 控制面 | 强制 `JWT_SECRET`/`ENCRYPTION_KEY`；关闭 `trustProxy` 或配置可信代理；CORS 受限；所有管理面需 admin。 |
| 认证 | Access/Refresh Token 分离；Refresh Token 可撤销；密码哈希升级。 |
| 进程隔离（第一阶段） | Server 进程与 Agent/Preview 进程运行在不同 OS 用户；目录 jail；cgroups/systemd 限制资源；禁止 Agent 访问 Server 代码/配置/数据库。 |
| 路径隔离 | `LocalFsAdapter` 强制 jail；解析 symlink；禁止返回绝对路径；不同 project 使用独立 workspace 目录。 |
| Secrets | 仅启动/重启时注入；不写入镜像、volume、deployment record、build log；provider key 不存明文 TOML。 |
| Preview | deployment-scoped token；校验 Host；公开/租户内两种模式可配置。 |
| Desktop Client | Refresh Token 存系统钥匙串；不缓存用户 secrets 明文。 |
| Web 管理面 | Admin 权限校验；不暴露普通用户 Coding 能力。 |

---

## 9. 可扩展性

- **水平扩展**：
  - Session bridge 状态外置到 Redis / NATS，或 Runtime Provider 直接暴露 stream endpoint。
  - 配额/单飞状态使用 Redis-backed distributed lock。
  - 数据库使用 PostgreSQL 替代 SQLite。
- **多 Runtime Provider**：通过 `runtime/registry.js` 插件化加载 Local / Docker / K8s provider。
- **LLM Gateway**：支持外部上游，控制面无状态转发。

---

## 10. 部署拓扑（推荐，第一阶段）

### 10.1 单节点自托管

```
[Server]
  ├─ XEnsemble Server (Node.js, port 3888)
  ├─ UniGateway (Rust, 127.0.0.1:8741)
  ├─ SQLite / Postgres
  └─ Local Execution Environment
      ├─ Agent PTY processes (node-pty)
      ├─ Preview processes
      └─ Workspace directories

[Desktop Clients] ──HTTPS/WSS──▶ [Server]
[Admin Browser]   ──HTTPS──────▶ [Server] (Web 管理面)
```

### 10.2 第二阶段：容器化

```
[Server]
  ├─ XEnsemble Server (Node.js)
  ├─ UniGateway
  └─ Docker Daemon / K8s Cluster

Runtime Provider 切换为 Docker/K8s，其他不变。
```

### 10.3 高可用（远期）

```
[Nginx / LB]
   ├── Server Instance 1
   ├── Server Instance 2
   └── Server Instance N
   [Shared Postgres]
   [Shared Redis]
   [Docker/K8s Runtime Cluster]
```

---

## 11. 移除/废弃清单

| 能力 | 处理方式 | 说明 |
|------|----------|------|
| 浏览器内代码编辑器 | 删除 | 用户用本地编辑器。 |
| Web Terminal（普通用户） | 移除入口 | 终端只在 Desktop Client；Admin 调试可保留开关。 |
| Web Admin UI | **保留** | 作为 Admin 管理台，与 Desktop Client 共用 API。 |
| iframe Preview | 删除 | Preview 用系统浏览器打开；Web 管理面仅展示链接。 |
| Web Console 作为用户 Coding 主入口 | 废弃 | Desktop Client 成为主入口。 |
| 内存单飞/内存配额 | 替换为 Redis | 支持多实例。 |
| 硬编码 JWT/加密密钥 | 删除回退 | 未配置则启动失败。 |
| `trustProxy: true` 默认 | 关闭或白名单 | 防止 IP/协议欺骗。 |
| CORS `origin: '*'` | 受限 | 只允许 Web 管理面与 Desktop Client origin。 |
| Docker 作为第一阶段默认 | 推迟到第二阶段 | 先使用本地执行降低部署门槛。 |

---

## 12. 迁移路径

### Phase 1 — 剥离 Web Coding & 强化认证 & 本地执行加固
1. 移除 `client/` 中面向普通用户的 Coding 入口（Web Terminal、iframe Preview、代码编辑器）。
2. 保留并加固 Web Admin UI。
3. WS 终端加 `access_token` 鉴权。
4. 引入 Refresh Token；强制生产环境配置 `JWT_SECRET`/`ENCRYPTION_KEY`。
5. 升级密码哈希参数。
6. 完善 Local Runtime Provider：
   - 实现 `LocalExecAdapter.exec`。
   - 实现 `RuntimeProvider.attachSession` 与本地 scrollback 缓存（文件/ring-buffer）。
   - 加固 `LocalFsAdapter` 路径 jail（解析 symlink、禁止绝对路径）。
   - Local preview 注入 scoped secrets。
7. 限制 Agent/Preview 进程权限（独立 OS 用户、cgroups、目录 jail）。

### Phase 2 — 真实 Revision & 状态外部化
1. Deployment revision 指向真实 checkpoint/gitSha/snapshot。
2. Session bridge 外置（Redis/NATS 或本地文件快照）。
3. Quota / singleflight 使用 Redis。
4. 支持 PostgreSQL。

### Phase 3 — Docker/K8s Runtime Provider
1. 实现 Docker/K8s Runtime Provider 全套 adapter。
2. 通过配置切换 provider，保持 Desktop Client / Web 管理面不变。

### Phase 4 — 生产 Gateway & 多实例
1. 子域名 Preview Gateway。
2. 多控制面实例 + 负载均衡。
3. 外部 UniGateway 生产部署。

---

## 13. 非目标

- 浏览器内代码编辑/IDE。
- 公共 SaaS 多租户计费。
- 完整的 CI/CD pipeline（可由外部 GitHub Actions 触发平台 API）。
- 原生移动端 Client（先聚焦 Desktop）。

---

## 14. 实施检查清单

- [ ] 更新 `docs/Architecture.md` 为本文内容。
- [ ] 调整 `client/`：移除普通用户 Coding 入口，保留 Admin Web UI。
- [ ] 调整 `desktop/`：接入后台 API/WS，作为用户主入口。
- [ ] 实现 Refresh Token 与 Access Token 分离。
- [ ] WS 终端鉴权。
- [ ] 实现 `LocalExecAdapter.exec`。
- [ ] 实现 `RuntimeProvider.attachSession` 与本地 scrollback 缓存。
- [ ] 加固 `LocalFsAdapter` 路径 jail。
- [ ] Local preview 注入 scoped secrets。
- [ ] Agent/Preview 进程以低权限用户运行并加资源限制。
- [ ] 修正 `FsAdapter.fsList` 签名与调用方。
- [ ] Deployment revision 使用真实 checkpoint/gitSha/snapshotId。
- [ ] Preview Gateway 使用 deployment-scoped token。
- [ ] 替换内存 quota/singleflight 为 Redis 实现。
- [ ] 升级 `drizzle-orm`、`fastify`、`glob` 等高危依赖。
- [ ] 增加 Runtime Provider contract tests（Local + stub Docker）。
- [ ] 更新 `deploy/` 中的 systemd/nginx 配置示例。

---

## 15. 相关文档

- 当前实现检查：`docs/Architecture.md`
- 客户端 API：`docs/ApiClient.md`
- 用户/配额：`docs/UserManagement.md`
- LLM 反代：`docs/LlmProxy.md`
- Agent 说明：`docs/agents.md`
- Desktop Client：`desktop/README.md`、`desktop/DESIGN.md`、`desktop/AGENTS.md`

---

*本设计确认后，将用于替换/更新 `docs/Architecture.md` 并进入 `writing-plans` 阶段。*
