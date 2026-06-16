# XEnsemble 用户管理

**用户、角色、配额与 Agent 授权规范**。控制面鉴权与授权实现须对齐本文；系统架构见 `docs/Architecture.md`，Console UI 见 `docs/Designs.md`。

## 1. 目标

XEnsemble 是后台部署的 Agent 运行管理系统。用户管理模块在控制面提供：

- **角色分离**：平台管理员（`admin`）与普通用户（`user`）
- **身份认证**：注册、登录、账号生命周期
- **配额管控**：管理员分配项目数、并发 Session、并发 Preview 等上限
- **Agent 授权**：管理员指定用户可使用哪些 Agent
- **强制校验**：所有限额在 API 入口检查，超限返回稳定错误码

执行面（Runtime / PTY / Preview）不变；授权与配额仅在控制面编排层生效。

## 2. 现状与缺口

### 2.1 已有能力

| 能力 | 实现位置 |
|------|----------|
| 注册 / 登录 | `POST /api/v1/auth/register`、`/login` |
| JWT 鉴权（7 天） | `server/src/auth/index.js` |
| 用户表 `role` 字段 | `users.role`：`admin` \| `user` |
| 首个注册用户自动 admin | `server.js` register 逻辑 |
| 项目按 `userId` 隔离 | `projects.userId` |
| Secrets Vault（按用户） | `secrets.userId` |
| Agent 全局注册表 | `agents` 表 + `AgentsAdmin` 页面 |

### 2.2 缺口

- 注册完全开放，无审批或邀请机制
- `admin` 角色仅控制前端导航；`POST /api/v1/agents` 未校验管理员身份
- `GET /api/v1/agents` 无需登录即可访问
- 无配额（项目数、并发 Session、Preview 等）
- 无 per-user Agent 白名单
- 无用户状态（封禁、待审批）、无管理员用户管理 API

> Architecture.md 第 10 节将「细粒度 RBAC 与计费」列为非目标。本文采用**管理员分配配额 + Agent 白名单**的两层模型，满足企业 B2B 部署，不引入 per-resource 权限矩阵。

## 3. 角色模型

| 角色 | 标识 | 能力 |
|------|------|------|
| 平台管理员 | `admin` | 用户 CRUD、分配配额与 Agent 权限、维护 Agent 注册表、查看全平台用量、平台配置 |
| 普通用户 | `user` | 使用已授权 Agent，在配额内管理 Project / Session / Preview / Secrets |

**用户状态**（`users.status`）：

| 状态 | 说明 |
|------|------|
| `active` | 可正常登录与调用 API |
| `suspended` | 管理员封禁，登录与 API 均拒绝 |
| `pending` | 注册后待审批（`registration_mode=approval` 时使用） |

## 4. 数据模型

在现有 `users` 表上扩展，新增配额与授权表。Schema 变更须经 `server/src/db/schema.js` + auto-migrate，与 Architecture.md 第 4 节风格一致。

### 4.1 `users` 扩展字段

```
status         TEXT DEFAULT 'active'     -- active | suspended | pending
email          TEXT                      -- 可选
display_name   TEXT
last_login_at  INTEGER
updated_at     INTEGER
```

保留现有字段：`id`、`username`、`password_hash`、`role`、`created_at`。

### 4.2 `user_quotas`（用户配额，一对一）

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `user_id` | TEXT PK, FK → users | — | |
| `max_projects` | INTEGER | 5 | 最大项目数 |
| `max_sessions` | INTEGER | 3 | 并发活跃 Session 数 |
| `max_previews` | INTEGER | 2 | 并发 Preview 数 |
| `max_runtimes` | INTEGER | 1 | 每项目 Runtime 上限（预留） |
| `resource_tier` | TEXT | `basic` | `basic` \| `pro` \| `enterprise`，映射 Runtime CPU/内存 |
| `updated_by` | TEXT FK → users | — | 最后修改的管理员 |
| `updated_at` | INTEGER | — | |

新用户创建时从 `platform_settings.default_user_quota` 继承；管理员可随时覆盖。

### 4.3 `user_agent_grants`（Agent 白名单）

| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | TEXT FK → users | |
| `agent_id` | TEXT FK → agents | |
| `granted_by` | TEXT FK → users | 授权管理员 |
| `granted_at` | INTEGER | |

主键：`(user_id, agent_id)`。

**语义**：用户仅能启动白名单内的 Agent。未授权任何 Agent 时，Session 启动一律拒绝。`admin` 不受白名单限制（可使用全部已安装 Agent）。

**自动授权**：Admin 在服务器上成功 **Install** 某 Agent 后，系统自动将该 Agent 授予所有非 `admin` 用户（已拥有该授权的用户跳过）。服务启动时亦会按当前**已安装** Agent 列表做一次幂等回填，补齐缺失授权。管理员仍可在 Users 页手动收回某用户的 Agent 权限。

### 4.4 `platform_settings`（平台配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | TEXT PK | 配置键 |
| `value` | TEXT | JSON 字符串 |

建议键：

| key | value 示例 |
|-----|------------|
| `registration_mode` | `"open"` \| `"invite_only"` \| `"admin_only"` \| `"approval"` |
| `default_user_quota` | `{"max_projects":5,"max_sessions":2,"max_previews":1,"resource_tier":"basic"}` |
| `session_ttl_hours` | `24`（可选，后续 Session 闲置回收） |

### 4.5 审计

复用 `events` 表（Architecture.md 第 4 节）：

- `subjectType`: `'user'`
- `subjectId`: 目标用户 id
- `type`: `quota_updated` \| `agent_granted` \| `agent_revoked` \| `suspended` \| `activated` \| `created` \| `password_reset`
- `data`: JSON（变更前后快照、操作者 id 等）

## 5. 注册与登录

### 5.1 注册模式

由 `platform_settings.registration_mode` 控制：

| 模式 | 行为 |
|------|------|
| `open` | 当前 MVP 行为；任何人可注册，继承默认配额 |
| `invite_only` | 需有效 invite token（Phase 2 增加 `invites` 表） |
| `admin_only` | 关闭自助注册；仅 `POST /api/v1/admin/users` |
| `approval` | 注册成功但 `status=pending`，管理员审批后变 `active` |

**Bootstrap**：数据库中第一个用户仍为 `admin`（与现逻辑一致）；之后注册用户默认 `user`。

### 5.2 登录

- 校验 `status === 'active'`；`suspended` / `pending` 返回 403 与明确错误码
- 更新 `last_login_at`
- JWT payload：`{ id, username, role, status }`（`status` 可选携带，关键写操作仍查 DB）

**Phase 3（生产）**：短效 Access Token + Refresh Token；可选 OIDC / SSO。

### 5.3 密码

- 最少 8 位（注册与修改时校验）
- 用户自行修改：`PUT /api/v1/auth/password`
- 管理员重置：`POST /api/v1/admin/users/:id/reset-password`

## 6. 权限与配额 Enforcement

### 6.1 PolicyService

控制面新增 `server/src/auth/PolicyService.js`（或同级模块），对外提供：

```
checkUserActive(user)                    → 403 if not active
checkAgentAccess(userId, agentId)        → 403 if not granted (admin bypass)
checkQuota(userId, dimension)            → 429 if at/over limit
getEffectiveQuota(userId)                → merged quota for /auth/me
listGrantedAgents(userId)                  → for GET /agents filter
```

### 6.2 挂载点

| API | 校验 |
|-----|------|
| 所有 `preValidation: [authenticate]` 路由 | `checkUserActive` |
| `POST /api/v1/session/start` | `checkAgentAccess` + `checkQuota('sessions')` |
| `POST /api/v1/projects` | `checkQuota('projects')` |
| `POST /api/v1/projects/:id/preview` | `checkQuota('previews')` |
| `POST /api/v1/deployments`（kind=preview） | `checkQuota('previews')` |
| `GET /api/v1/agents` | 需登录；普通用户仅返回已授权 Agent |

### 6.3 计数规则

| 维度 | 计数方式 |
|------|----------|
| `max_projects` | `COUNT(projects WHERE user_id = ?)` |
| `max_sessions` | `COUNT(sessions WHERE user_id = ? AND status = 'running')` |
| `max_previews` | `COUNT(deployments WHERE user_id = ? AND kind = 'preview' AND status IN ('pending','building','running'))` |

### 6.4 错误响应

对齐 Architecture.md 3.1 错误码表：

| 场景 | HTTP | body 示例 |
|------|------|-----------|
| 未登录 / token 无效 | 401 | `{ "error": "Unauthorized" }` |
| 非 admin 访问管理 API | 403 | `{ "error": "Forbidden" }` |
| 账号 suspended / pending | 403 | `{ "error": "account_suspended" }` |
| Agent 未授权 | 403 | `{ "error": "agent_not_granted", "agent_id": "..." }` |
| 配额超限 | 429 | `{ "error": "quota_exceeded", "dimension": "max_sessions", "limit": 3, "current": 3 }` |

## 7. API 契约

### 7.1 公开 / 用户面

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/auth/me                 # 用户信息 + quotas 摘要 + granted_agents 数量
PUT    /api/v1/auth/password           # body: { current_password, new_password }
```

`GET /auth/me` 响应示例：

```json
{
  "id": "usr_abc",
  "username": "alice",
  "role": "user",
  "status": "active",
  "quotas": {
    "max_projects": 5,
    "max_sessions": 2,
    "max_previews": 1,
    "resource_tier": "basic",
    "usage": { "projects": 2, "sessions": 1, "previews": 0 }
  }
}
```

### 7.2 管理员面

所有路由：`preValidation: [authenticate, requireAdmin]`。

```
GET    /api/v1/admin/users
POST   /api/v1/admin/users             # 创建用户（admin_only 模式主路径）
GET    /api/v1/admin/users/:id
PATCH  /api/v1/admin/users/:id         # status, display_name, role（不可降级最后一个 admin）
DELETE /api/v1/admin/users/:id         # 软删除：设 status=suspended

PUT    /api/v1/admin/users/:id/quota   # 全量设置配额
GET    /api/v1/admin/users/:id/quota

PUT    /api/v1/admin/users/:id/agents  # body: { "agent_ids": ["kimi-code", "..."] } 全量替换
POST   /api/v1/admin/users/:id/agents/:agentId
DELETE /api/v1/admin/users/:id/agents/:agentId

POST   /api/v1/admin/users/:id/reset-password
GET    /api/v1/admin/platform-settings
PUT    /api/v1/admin/platform-settings
```

`GET /admin/users` 列表项含用量摘要：`projects_count`、`active_sessions`、`active_previews`。

### 7.3 现有 API 加固

| 变更 | 说明 |
|------|------|
| `GET /api/v1/agents` | 增加 `authenticate`；按授权过滤 |
| `POST /api/v1/agents` | 增加 `requireAdmin` |
| 新增 `PUT /api/v1/agents/:id` | 管理员更新 Agent |
| 新增 `DELETE /api/v1/agents/:id` | 管理员删除（需检查无活跃 grant） |

## 8. 控制面模块结构

```
server/src/auth/
  index.js              # JWT、密码、Vault（现有）
  hooks.js              # authenticate, requireAdmin, requireActive
  PolicyService.js      # 配额与 Agent 授权

server/src/admin/
  UserAdminService.js   # 用户 CRUD、配额、授权
  PlatformSettings.js   # 平台配置

server/src/routes/      # 可选：从 server.js 拆出
  auth.js
  admin.js
```

Fastify hooks：

- `authenticate`：解析 Bearer JWT，设置 `request.user`（现有）
- `requireAdmin`：`request.user.role === 'admin'`，否则 403
- `requireActive`：查 DB `users.status === 'active'`

## 9. 前端（Designs.md 扩展）

实现前须在 `docs/Designs.md` 补充对应小节；以下为数据与交互契约。

### 9.1 `/admin/users` — User Management

- 布局：与 `AgentsAdmin` 一致（`PageHeader` + 表格 + `ConsoleDialog`）
- 表格列：用户名、状态徽章、项目/Session/Preview 用量、配额摘要、最后登录
- 行操作：编辑配额、分配 Agent（多选 `SelectMenu`）、暂停/恢复、重置密码
- 新建用户：弹窗表单（username、password、初始配额、Agent 多选）
- 反馈：一律 `useToast`（见 Designs.md Toast 节）

### 9.2 `/admin/settings` — Platform Settings（Phase 2）

- 注册模式 `SelectMenu`
- 默认配额模板表单

### 9.3 普通用户 Console

- Agent 下拉仅显示已授权项；无授权时禁用启动并 toast 提示联系管理员
- Settings 弹窗增加只读「我的配额」：项目 X/Y、并发 Session X/Y、Preview X/Y

### 9.4 导航

`App.jsx`：`user.role === 'admin'` 时显示 **Users**、**Platform**（或 Settings）链接，与现有 **Agents** 并列。

## 10. 与 Architecture 对齐

| 架构要求 | 本模块做法 |
|----------|------------|
| 多租户隔离 | 保持 `project.userId`、`deployment.userId`；授权不改变归属模型 |
| Preview Gateway 鉴权 | Gateway 校验 token 时叠加用户 `status` 与 project 访问权 |
| `resource_tier` | 写入 `user_quotas`，下发到 `deployments.resourceTier` / `runtimes.specs` |
| 资源超限 429 | PolicyService 在 session/preview/project 创建前检查 |
| 审计 | `events` 表记录管理员操作 |
| 执行面无鉴权逻辑 | Runtime adapter 不感知用户；控制面在 spawn 前完成全部检查 |

## 11. 关键流程

### 11.1 Session 启动

```
Client → POST /session/start { agent_id, project_id }
  → authenticate + requireActive
  → getProjectForUser（项目归属）
  → PolicyService.checkAgentAccess(user, agent_id)
  → PolicyService.checkQuota(user, 'sessions')
  → ensureProjectRuntime + exec.spawn
  → 写 sessions 表
```

### 11.2 管理员分配权限

```
Admin → PUT /admin/users/:id/quota
     → PUT /admin/users/:id/agents { agent_ids: [...] }
  → UserAdminService 写 DB
  → recordEvent(user, quota_updated | agent_granted)
```

## 12. 默认配额建议（企业部署）

| 维度 | 普通用户默认 | 说明 |
|------|-------------|------|
| max_projects | 5 | 按团队调整 |
| max_sessions | 2 | 并发 Agent 终端 |
| max_previews | 1 | 并发 Preview |
| resource_tier | basic | 后续映射容器规格 |
| Agent 授权 | 管理员显式勾选 | 默认无授权，避免误开高成本 CLI |

生产环境建议 `registration_mode` 为 `admin_only` 或 `approval`。

## 13. 实施分期

### Phase 1 — 核心（已完成）

- [x] Schema：`users` 扩展、`user_quotas`、`user_agent_grants`
- [x] `PolicyService` + auth hooks（`requireAdmin`、`requireActive`）
- [x] Admin API：用户列表/创建/配额/Agent 授权
- [x] `session/start`、`POST /projects`、preview 路径配额校验
- [x] `GET /agents` 鉴权 + 过滤；`POST /agents` 限 admin
- [x] 前端 `/admin/users` 页面
- [x] `GET /auth/me` 含配额与用量

### Phase 2 — 运营（已完成）

- [x] `platform_settings` + 注册模式
- [x] 用户审批（`pending` → `active`）
- [x] 密码重置、审计 events
- [x] `/admin/platform` 页面
- [x] Console Settings「Quota」只读展示
- [x] 运维 CLI：`server/scripts/manage-user.js`

### Phase 3 — 生产（未开始）

- [ ] Refresh Token
- [ ] Invite 链接、`invites` 表
- [ ] `resource_tier` 对接 Runtime provider specs
- [ ] 可选 OIDC / SSO

## 14. 快速开始（管理员 Bootstrap）

**系统没有预设的管理员账号和密码。** 首次部署可用以下任一方式获得管理员：

| 方式 | 适用场景 |
|------|----------|
| 空库首个注册用户 | 全新安装；数据库无用户时，第一个注册账号自动为 `admin` |
| 运维 CLI | 已有用户库、忘记密码、需紧急提权（推荐） |
| 管理台创建 | 已有 admin 登录后，在 **Users → Add User** 创建并设 `role=admin` |

数据库文件：`server/data/emdash.db`（SQLite）。

密码要求：注册、改密、CLI 重置均至少 **8 位**。

## 15. 运维 CLI（`manage-user.js`）

本地运维脚本，**直接读写 SQLite**，无需启动后端。在 `server/` 目录执行：

```bash
cd server

# 列出所有用户（id / username / role / status / last_login）
npm run manage-user -- list

# 将已有用户提升为管理员（并设 status=active）
npm run manage-user -- promote <username>

# 降级为普通用户（不可降级最后一个 active admin）
npm run manage-user -- demote <username>

# 重置密码（至少 8 位；含特殊字符时用引号包裹）
npm run manage-user -- password <username> '<new-password>'

# 创建新管理员；若用户名已存在则改密并提升
npm run manage-user -- create-admin <username> '<password>'
```

等价调用：`node scripts/manage-user.js <command> ...`

示例：

```bash
npm run manage-user -- list
npm run manage-user -- promote alice
npm run manage-user -- password alice 'SecurePass123'
npm run manage-user -- create-admin admin 'AdminPass123'
```

CLI 操作会写入 `events` 表（`subjectType=user`，`data.action` 为 `cli_promote` / `cli_demote` / `cli_password` / `cli_create_admin`）。

## 16. 管理台使用说明

管理员登录后，顶栏出现 **Users · Agents**（见 `docs/Designs.md` 用户管理节）；平台配置在 Settings → Platform。

### 16.1 Users（`/admin/users`）

| 操作 | 说明 |
|------|------|
| Add User | 创建用户：用户名、密码、角色、状态、配额、Agent 授权 |
| 编辑（铅笔） | 修改角色/状态、配额、Agent 白名单、可选重置密码 |
| 审批（勾） | `pending` 用户一键设为 `active` |
| 暂停（禁） | `active` ↔ `suspended` 切换 |

表格用量列：**P** = 项目数，**S** = 并发 Session，**V** = 并发 Preview（当前值/上限）。

**Agent 授权**：普通用户须在弹窗中勾选 Agent；`admin` 不受白名单限制。新建用户默认无 Agent 授权。

### 16.2 Platform（`/admin/platform`）

| 配置项 | 说明 |
|--------|------|
| Registration mode | `open` / `approval` / `admin_only` / `invite_only`（后者 Phase 3） |
| Default user quota | 新用户继承的项目/Session/Preview 上限与 tier |
| Session TTL | 预留；后续 Session 闲置回收 |

生产建议：`registration_mode` 设为 `admin_only` 或 `approval`。

### 16.3 Agents（`/admin/agents`）

维护全局 Agent 注册表、检测/安装服务器 CLI、配置平台级 API keys；仅 admin 可操作。普通用户只能看到被授权的 Agent，不能配置 API keys。

### 16.4 普通用户 Console

- Agent 下拉仅显示已授权项；无授权时 Launch 按钮禁用。
- **Settings → Quota**：只读查看配额与用量。
- 配额或授权不足时，Launch 弹窗内展示错误（非 toast）。

## 17. 实现对照（代码文件）

| 能力 | 路径 |
|------|------|
| Schema | `server/src/db/schema.js`、`server/src/db/index.js`（auto-migrate） |
| JWT / 密码 / Vault | `server/src/auth/index.js` |
| 鉴权 hooks | `server/src/auth/hooks.js` |
| 配额与 Agent 授权 | `server/src/auth/PolicyService.js` |
| 用户 CRUD / 登录 | `server/src/admin/UserAdminService.js` |
| 平台配置 | `server/src/admin/PlatformSettings.js` |
| 用户面 API | `server/src/routes/auth.js` |
| 管理面 API | `server/src/routes/admin.js` |
| 路由挂载与 enforcement | `server/src/server.js` |
| 运维 CLI | `server/scripts/manage-user.js` |
| 冒烟测试 | `server/scripts/smoke-user-management.js` |
| 用户管理页 | `client/src/pages/UsersAdmin.jsx` |
| 平台配置页 | `client/src/pages/PlatformSettingsAdmin.jsx` |
| 配额 Settings | `client/src/components/settings/QuotaSettingsPanel.jsx` |

## 18. 开发对齐要求

- 实现或评审用户、配额、Agent 授权相关代码前，须阅读本文 + `Architecture.md` + `Designs.md`
- Schema 变更同步更新 `server/src/db/schema.js` 与本文第 4 节
- 新增 Console 管理页面前，先在 `Designs.md` 登记 UI 细则
- 关键路径须有测试：`PolicyService` 单元测试 + `session/start` 配额/授权集成测试

---

*版本：v1.1（2026-06；补充 Bootstrap、运维 CLI、管理台说明、实现对照与 Phase 1/2 完成状态）*  
*维护：用户管理行为变更须 PR + 更新本文。*
