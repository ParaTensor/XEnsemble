# GitHub 工作流集成设计

> 状态：设计草案（待实现）  
> 日期：2026-06-22  
> 适用范围：`server/` 控制面、`desktop/` Desktop Client、`client/` Web 管理面  
> 依赖：`docs/Architecture.md`（执行面三层 Provider）、`docs/ApiClient.md`（REST/WS 协议）、`DESIGN.md` / `docs/Designs.md`（Console UI）

---

## 1. 设计目标

支持用户将 GitHub 仓库导入 XEnsemble，在 Agent workspace 内的 Git 分支上进行开发，并直接从平台提交 PR 回 GitHub——形成完整的 **Import → Branch → Develop → PR** 开发闭环，类似 Devin 的工作模式。

### 1.1 核心用户故事

1. **导入仓库**：用户在 Desktop Client 中连接 GitHub 账号，选择一个 GitHub 仓库导入为 XEnsemble 项目，系统自动 clone 到 workspace。
2. **分支开发**：Agent session 在独立分支上工作（自动创建或用户指定），不影响主分支。
3. **提交 PR**：开发完成后，用户在 Desktop Client 中一键将当前分支提交为 GitHub PR，填写标题和描述。
4. **同步与更新**：用户可以从上游主分支拉取最新代码合并到工作分支，保持同步。
5. **多仓库管理**：用户可以同时管理多个已导入的 GitHub 项目，查看分支/PR 状态。

### 1.2 非目标（Phase 1）

- GitHub App marketplace 发布（先使用 OAuth App 或自建 GitHub App）。
- Webhook 驱动的实时 PR 事件同步（先使用轮询 + 用户触发刷新）。
- 代码 Review 界面（用户在 GitHub 上完成 Review）。
- 支持 GitLab、Bitbucket 等其他 Git 平台（架构预留抽象，但不实现）。
- GitHub Actions CI/CD 集成。

---

## 2. 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Desktop Client                                │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐       │
│  │ GitHub OAuth  │  │ Repo Import │  │ Branch / PR 管理  │       │
│  │ 连接 / 断开   │  │ 选库 / Clone │  │ 创建 / 查看 / 同步│       │
│  └──────────────┘  └─────────────┘  └──────────────────┘       │
└───────────────────┬─────────────────────────────────────────────┘
                    │ HTTPS / WSS
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    XEnsemble Server 控制面                       │
│  ┌─────────────────┐  ┌───────────────────┐                     │
│  │ GitHubService    │  │ GitOperationService│                    │
│  │ OAuth / Token    │  │ clone / branch /   │                    │
│  │ API 代理         │  │ commit / push / PR │                    │
│  └─────────────────┘  └───────────────────┘                     │
│  ┌─────────────────┐  ┌───────────────────┐                     │
│  │ RepositoryEnv    │  │ RuntimeProvider    │                    │
│  │ (已有 + 扩展)    │  │ (workspace FS)     │                    │
│  └─────────────────┘  └───────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
          ┌─────────────────┐
          │  GitHub API       │
          │  (REST v3 / GQL)  │
          └─────────────────┘
```

### 关键设计决策

- **Git 操作在 Runtime 侧执行**：clone/pull/push/branch 等 git 命令通过 `ExecAdapter.exec` 在 workspace 所在的执行环境中运行（Local、BoxLite、K8s 均适用）。控制面只负责编排、鉴权和状态记录。
- **GitHub API 调用在控制面**：OAuth token 管理、GitHub REST API（仓库列表、PR 创建/查询）在控制面执行，token 不注入 agent 环境。
- **Git 认证通过临时凭据**：push/pull 时，控制面签发短期 credential（git credential helper 或 token URL），避免长期 token 落地到 workspace。

---

## 3. GitHub 认证

### 3.1 OAuth App 方案（Phase 1 推荐）

使用 GitHub OAuth App 获取用户级 access token，权限范围 `repo`（私有仓库读写）。

**优点**：配置简单，无需 GitHub App 安装流程。  
**缺点**：token 权限粒度较粗（用户级而非仓库级）。

#### 3.1.1 OAuth 流程

```
Desktop Client                   Server                        GitHub
     │                              │                              │
     │  1. 打开系统浏览器             │                              │
     │  → github.com/login/oauth    │                              │
     │     ?client_id=...           │                              │
     │     &redirect_uri=...        │                              │
     │     &scope=repo              │                              │
     │     &state=<random>          │                              │
     │                              │                              │
     │                              │  2. 用户授权后 GitHub 回调     │
     │                              │  ← GET /api/v1/github/callback│
     │                              │     ?code=...&state=...       │
     │                              │                              │
     │                              │  3. Server 用 code 换 token   │
     │                              │  → POST github.com/access_token
     │                              │  ← access_token              │
     │                              │                              │
     │                              │  4. 加密存储 token            │
     │                              │  → github_connections 表      │
     │  5. 轮询或 WS 通知            │                              │
     │  ← 连接成功                   │                              │
```

#### 3.1.2 Desktop Client 回调与轮询（Phase 1 默认）

Phase 1 **不**使用自定义协议或本地 HTTP server，避免 Electron 协议注册复杂度和防火墙问题：

1. Desktop Client 调用 `POST /api/v1/github/connect` 获取 `auth_url`，打开系统浏览器访问 GitHub 授权页。
2. GitHub 授权后重定向到 Server 的 `GET /api/v1/github/callback?code=...&state=...`。
3. Server 用 `code` 换取 `access_token`，写入 `github_connections`，然后返回一个 HTML 页面提示“授权成功，请返回 Desktop Client”。
4. Desktop Client 在打开浏览器后启动轮询，每 **2 秒**调用 `GET /api/v1/github/connection`，检测到连接成功后关闭浏览器提示并刷新 UI。

POST `/api/v1/github/callback` 保留为 Desktop Client 的备选方式（当 Desktop 有能力监听本地回调时）。

#### 3.1.3 GitHub OAuth App 创建指南

管理员按以下步骤创建 OAuth App（完整截图与字段说明见附录 A）：

1. 登录 GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**。
2. 填写：
   - **Application name**：`XEnsemble`（或组织自有品牌名）。
   - **Homepage URL**：`{CONTROL_PLANE_PUBLIC_URL}`。
   - **Authorization callback URL**：`{CONTROL_PLANE_PUBLIC_URL}/api/v1/github/callback`。
3. 创建后记录 **Client ID** 和 **Client Secret**。
4. 在 XEnsemble Settings → GitHub 中填入上述两项，保存。

> 注意：Client Secret 只显示一次，请妥善保存；如遗失可在 GitHub 上重新生成。更详细的字段说明见附录 A。

### 3.2 GitHub App 方案（Phase 2 可选）

使用 GitHub App + Installation Token 实现仓库级细粒度权限。

- 支持组织级安装，管理员统一授权仓库子集。
- Installation token 短期有效（1h），控制面按需刷新。
- 可监听 Webhook 获取 PR/push 事件。

### 3.3 平台配置

Admin 在 Settings → **GitHub** 面板配置：

| 字段 | 说明 |
|------|------|
| `GITHUB_CLIENT_ID` | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App client secret（加密存储） |
| `GITHUB_CALLBACK_URL` | 回调地址，默认 `{CONTROL_PLANE_PUBLIC_URL}/api/v1/github/callback` |
| `GITHUB_API_BASE` | GitHub API 基址，默认 `https://api.github.com`（支持 GHE） |

存储在 `platform_settings` 表（复用现有 `PlatformSettings` 服务），secret 类字段使用现有 `auth.encryptSecrets` 加密。

---

## 4. 数据模型

### 4.1 新增表

#### `github_connections`

用户级 GitHub 连接（OAuth token 存储）。

```sql
CREATE TABLE github_connections (
  id               TEXT PRIMARY KEY,          -- 'ghconn_...'
  user_id          TEXT NOT NULL REFERENCES users(id),
  github_user_id   INTEGER NOT NULL,          -- GitHub user numeric ID
  github_username  TEXT NOT NULL,
  github_avatar    TEXT,
  access_token_enc TEXT NOT NULL,             -- 加密的 OAuth access token
  token_scope      TEXT,                      -- 'repo,user' etc.
  connected_at     INTEGER NOT NULL,
  last_used_at     INTEGER,
  revoked_at       INTEGER                   -- soft delete
);
-- UNIQUE(user_id) — Phase 1 每用户仅一个 GitHub 连接
```

#### `github_oauth_states`

OAuth `state` 临时缓存，用于绑定未登录回调请求与发起用户，5 分钟过期后清理。

```sql
CREATE TABLE github_oauth_states (
  state      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
```

#### `project_branches`

项目内分支追踪（缓存/快照，非实时；以 workspace 中 `git branch` 的实际输出为准）。

```sql
CREATE TABLE project_branches (
  id              TEXT PRIMARY KEY,          -- 'br_...'
  project_id      TEXT NOT NULL REFERENCES projects(id),
  branch_name     TEXT NOT NULL,
  base_branch     TEXT,                      -- 从哪个分支创建
  is_active       INTEGER DEFAULT 0,        -- 当前 workspace checkout 的分支
  last_commit_sha TEXT,
  ahead_count     INTEGER DEFAULT 0,         -- ahead of base
  behind_count    INTEGER DEFAULT 0,         -- behind base
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(project_id, branch_name)
);
```

#### `pull_requests`

平台创建的 PR 追踪（镜像 GitHub PR 状态）。

```sql
CREATE TABLE pull_requests (
  id                 TEXT PRIMARY KEY,        -- 'pr_...'
  project_id         TEXT NOT NULL REFERENCES projects(id),
  github_pr_number   INTEGER NOT NULL,
  github_pr_url      TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  source_branch      TEXT NOT NULL,
  target_branch      TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open',  -- open / merged / closed
  github_state       TEXT,                    -- GitHub API 返回的原始状态
  merge_sha          TEXT,
  created_by         TEXT REFERENCES users(id),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  last_synced_at     INTEGER,
  UNIQUE(project_id, github_pr_number)
);
```

### 4.2 已有表扩展

#### `projects` 表

`server/src/db/schema.js` 中 `projects` 表已包含 Phase 1 所需的大部分字段：

| 已有字段 | 用途 |
|----------|------|
| `repoProvider` | 设为 `'github'` |
| `repoUrl` | GitHub HTTPS clone URL |
| `repoDefaultBranch` | `'main'` 或 `'master'` |
| `repoInstallationRef` | GitHub App installation ID（Phase 2） |
| `repoTokenSecretRef` | 指向 `github_connections.id` |
| `workspaceMode` | 设为 `'git'` |
| `lastSyncSha` | 最近一次 sync 的 commit SHA |

Phase 1 需新增字段：

```sql
ALTER TABLE projects ADD COLUMN current_branch TEXT;     -- workspace 当前分支
ALTER TABLE projects ADD COLUMN github_repo_id INTEGER;  -- GitHub repo numeric ID
ALTER TABLE projects ADD COLUMN github_full_name TEXT;   -- 'owner/repo'
ALTER TABLE projects ADD COLUMN clone_status TEXT DEFAULT 'pending';  -- pending / cloning / ready / failed
ALTER TABLE projects ADD COLUMN clone_error TEXT;        -- 失败原因
```

> 注：`github_repo_id` 与 `github_full_name` 为 GitHub 特有；未来支持多平台时，这些字段应被更中性的 provider 元数据替代。

---

## 5. 服务层设计

### 5.1 GitHubService（控制面）

`server/src/github/GitHubService.js`

负责 GitHub OAuth 流程和 GitHub REST API 调用。**不**直接执行 git 命令。

```
GitHubService
  ├─ exchangeOAuthCode(code) → access_token
  ├─ getAuthenticatedUser(token) → { id, login, avatar_url }
  ├─ listUserRepos(token, opts) → [{ id, full_name, clone_url, default_branch, private }]
  ├─ getRepo(token, owner, repo) → { ... }
  ├─ createPullRequest(token, owner, repo, { title, body, head, base }) → PR
  ├─ getPullRequest(token, owner, repo, number) → PR
  ├─ listPullRequests(token, owner, repo, opts) → [PR]
  └─ revokeToken(token) → void
```

- 所有方法接收解密后的 token，由调用方负责解密。
- HTTP client 使用 Node.js 内置 `fetch`（项目已使用 Node 18+）。
- 错误码映射：`401 → token_expired`、`403 → insufficient_scope`、`404 → repo_not_found`。
- Git 认证不通过 `GitHubService` 签发长期 credential；`GitOperationService` 直接使用短期 token 注入 `GIT_ASKPASS`（详见 5.2）。

### 5.2 GitOperationService（控制面 + 执行面协同）

`server/src/github/GitOperationService.js`

编排 Git 操作：控制面准备凭据和状态，通过 `ExecAdapter.exec` 在 Runtime 中执行 git 命令。服务初始化时注入 `RuntimeService`（或等价的 `getExecAdapter(project)` 工厂），每个方法内部先 `ensureProjectRuntime(project)` 取得 `workspacePath` 与 `execAdapter`。

```
GitOperationService
  ├─ cloneRepo(project, { repoUrl, branch, depth }) → { sha, branch }
  ├─ pullLatest(project) → { sha, behind, ahead }
  ├─ createBranch(project, branchName, baseBranch) → { branch }
  ├─ switchBranch(project, branchName) → { branch, sha }
  ├─ deleteBranch(project, branchName) → void
  ├─ listBranches(project) → [{ name, current, sha }]
  ├─ getStatus(project) → { branch, sha, dirty, staged, untracked, ahead, behind }
  ├─ commitAll(project, message) → { sha }
  ├─ pushBranch(project, branchName, { force? }) → { sha }
  ├─ mergeBranch(project, fromBranch, toBranch) → { sha, conflicts? }
  ├─ getDiff(project, { base?, head? }) → string
  └─ getLog(project, { branch?, limit? }) → [{ sha, message, author, date }]
```

**Git 认证注入策略：**

优先使用 **URL embed 方式**：在执行 push/pull/clone 时把 remote URL 临时替换为
```
https://x-access-token:<token>@github.com/owner/repo.git
```
该方式无需写临时文件，适合 Local / BoxLite / K8s 所有 Runtime。

备选方式（Local Runtime 可用）：
1. 控制面解密 `github_connections.access_token_enc` → plaintext token。
2. 构造 `GIT_ASKPASS` 脚本并写入临时文件：
   ```sh
   #!/bin/sh
   case "$1" in
     *Username*) echo "x-access-token" ;;
     *Password*) echo "<token>" ;;
   esac
   ```
3. 通过 `ExecAdapter.exec` 执行 git 命令，注入 env：`GIT_ASKPASS=/tmp/xe-credential-<random>.sh`。
4. 命令完成后立即删除临时凭据文件。

对 BoxLite/K8s Runtime：凭据仅通过 `ExecAdapter.exec` 的 env/参数传入，不持久化到 workspace 或 volume。

### 5.3 PullRequestService（控制面）

`server/src/github/PullRequestService.js`

```
PullRequestService
  ├─ create(project, { title, body, sourceBranch, targetBranch }) → PR record
  │   1. 调用 GitOperationService.pushBranch 确保分支已推送
  │   2. 调用 GitHubService.createPullRequest 在 GitHub 创建 PR
  │   3. 写入 pull_requests 表
  │   4. recordEvent
  │
  ├─ sync(project, prId) → updated PR record
  │   1. 调用 GitHubService.getPullRequest 获取最新状态
  │   2. 更新 pull_requests 表
  │
  ├─ list(projectId) → [PR]
  └─ get(prId) → PR
```

### 5.4 GitConnectionService（控制面）

`server/src/github/GitConnectionService.js`

管理用户的 GitHub 连接生命周期。

```
GitConnectionService
  ├─ initiateOAuth(userId) → { authUrl, state }
  │   1. 生成随机 state
  │   2. 写入 github_oauth_states(state, user_id, expires_at=now+5min)
  │   3. 返回 { authUrl, state }
  │
  ├─ completeOAuthFromCallback(code, state) → connection record
  │   1. 通过 state 查找 user_id（公开 GET 回调无 JWT）
  │   2. 删除 state 记录
  │   3. 调用内部 _finishOAuth(userId, code)
  │
  ├─ completeOAuthFromDesktop(userId, code, state) → connection record
  │   1. 校验 state 属于该 user_id（Desktop POST 带 JWT）
  │   2. 删除 state 记录
  │   3. 调用内部 _finishOAuth(userId, code)
  │
  ├─ getConnection(userId) → connection | null
  ├─ refreshConnection(userId) → updated connection  // OAuth App 无 refresh；仅验证 token 有效性
  ├─ disconnect(userId) → void  // revoke + soft delete
  └─ getDecryptedToken(userId) → plaintext token (内部方法)
```

---

## 6. API 端点

新增路由文件 `server/src/routes/github.js`，在 `server/src/server.js` 中通过 `registerGitHubRoutes(fastify)` 注册。

- 除明确标注“公开”的路由外，其余均需 `fastify.authenticate` + `fastify.requireActive`。
- `GET /api/v1/github/callback` 由 GitHub 浏览器重定向触发，**无法携带 JWT**，因此为公开路由，通过 `state` 参数校验请求来源与有效期。

### 6.1 GitHub 连接

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/v1/github/connection` | 需 JWT | 获取当前用户的 GitHub 连接状态（不含 token） |
| POST | `/api/v1/github/connect` | 需 JWT | 发起 OAuth，返回 `{ auth_url }` |
| GET | `/api/v1/github/callback?code=&state=` | 公开 | GitHub OAuth 回调（Server 处理后重定向或返回 HTML） |
| POST | `/api/v1/github/callback` | 需 JWT | Desktop Client POST 方式完成 OAuth code 交换 |
| DELETE | `/api/v1/github/connection` | 需 JWT | 断开 GitHub 连接，撤销 token |
| GET | `/api/v1/github/repos` | 需 JWT | 列出用户可见的 GitHub 仓库（带分页/搜索） |
| GET | `/api/v1/github/repos/:owner/:repo` | 需 JWT | 获取单个仓库详情 |

### 6.2 项目仓库操作

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/projects/import-github` | 导入 GitHub 仓库为新项目 |
| POST | `/api/v1/projects/:id/git/clone` | 对已有项目执行初始 clone |
| POST | `/api/v1/projects/:id/git/pull` | 拉取最新代码 |
| GET | `/api/v1/projects/:id/git/status` | 获取 git status（branch, dirty, ahead/behind） |
| GET | `/api/v1/projects/:id/git/diff` | 获取 diff |
| GET | `/api/v1/projects/:id/git/log` | 获取 commit 历史 |
| POST | `/api/v1/projects/:id/git/commit` | 提交所有变更 |
| POST | `/api/v1/projects/:id/git/push` | 推送当前分支 |

### 6.3 分支管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/projects/:id/branches` | 列出分支（local + tracking remote） |
| POST | `/api/v1/projects/:id/branches` | 创建分支 `{ name, base_branch? }` |
| POST | `/api/v1/projects/:id/branches/switch` | 切换分支 `{ branch }` |
| DELETE | `/api/v1/projects/:id/branches/:name` | 删除本地分支 |
| POST | `/api/v1/projects/:id/branches/merge` | 合并分支 `{ from, to }` |

### 6.4 Pull Request 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/projects/:id/pull-requests` | 列出该项目的 PR |
| POST | `/api/v1/projects/:id/pull-requests` | 创建 PR `{ title, body, target_branch? }` |
| GET | `/api/v1/projects/:id/pull-requests/:prId` | 获取单个 PR 详情 |
| POST | `/api/v1/projects/:id/pull-requests/:prId/sync` | 同步 GitHub PR 最新状态 |

### 6.5 请求/响应示例

#### 导入 GitHub 仓库

```http
POST /api/v1/projects/import-github
Authorization: Bearer <jwt>

{
  "github_repo_full_name": "owner/repo",
  "name": "My Imported Project",          // 可选，默认用 repo name
  "branch": "main",                        // 可选，默认用 default_branch
  "auto_create_branch": true,              // 是否自动创建工作分支
  "work_branch_name": "xensemble/dev"      // 工作分支名，auto_create_branch=true 时
}
```

响应：

```json
{
  "id": "proj_abc123",
  "name": "My Imported Project",
  "github_full_name": "owner/repo",
  "repo_url": "https://github.com/owner/repo.git",
  "current_branch": "xensemble/dev",
  "status": "cloning",                     // cloning → ready
  "created_at": 1718000000000
}
```

Clone 为异步操作（大仓库耗时较长），通过轮询 `GET /api/v1/projects/:id` 的 `clone_status` 字段或 WS 事件通知完成。

#### 创建 PR

```http
POST /api/v1/projects/proj_abc123/pull-requests
Authorization: Bearer <jwt>

{
  "title": "feat: add user authentication",
  "body": "## Changes\n- Added login page\n- JWT implementation",
  "target_branch": "main"
}
```

响应：

```json
{
  "id": "pr_xyz789",
  "github_pr_number": 42,
  "github_pr_url": "https://github.com/owner/repo/pull/42",
  "title": "feat: add user authentication",
  "source_branch": "xensemble/dev",
  "target_branch": "main",
  "status": "open",
  "created_at": 1718000000000
}
```

---

## 7. 文件结构

### 7.1 Server

```
server/src/github/
  ├─ GitHubService.js            # GitHub API 客户端
  ├─ GitConnectionService.js     # OAuth 连接管理
  ├─ GitOperationService.js      # Git 命令编排
  ├─ PullRequestService.js       # PR 生命周期
  ├─ gitCredentialHelper.js      # 临时凭据生成/注入
  └─ __tests__/
      ├─ GitHubService.test.js
      ├─ GitOperationService.test.js
      └─ PullRequestService.test.js

server/src/routes/
  ├─ github.js                   # GitHub 连接 + 仓库列表路由
  ├─ projects-git.js             # 项目级 git/branch/PR 路由（或合并入 github.js）
  └─ ...

server/src/db/schema.js          # 扩展 projects 表 + 新增 github_connections 等
server/src/db/migrations/        # 新增迁移脚本
```

### 7.2 Desktop Client

```
desktop/src/renderer/
  ├─ pages/
  │   └─ ... (现有页面)
  ├─ components/
  │   ├─ github/
  │   │   ├─ GitHubConnectButton.jsx    # 连接/断开 GitHub
  │   │   ├─ RepoImportDialog.jsx       # 仓库导入弹窗
  │   │   ├─ BranchSelector.jsx         # 分支选择/切换
  │   │   ├─ GitStatusBar.jsx           # 底部 git 状态条
  │   │   ├─ CreatePRDialog.jsx         # 创建 PR 弹窗
  │   │   └─ PRListPanel.jsx            # PR 列表
  │   └─ ...
  ├─ hooks/
  │   ├─ useGitHub.js                   # GitHub 连接状态
  │   ├─ useGitStatus.js                # 轮询 git status
  │   └─ usePullRequests.js             # PR 列表管理
  └─ lib/
      └─ githubApi.js                   # GitHub API 调用封装
```

---

## 8. Desktop UI 设计

Desktop Client UI 遵循 `DESIGN.md` / `docs/Designs.md` 的 Console 规范：zinc 配色、`ConsoleDialog` 弹窗、`useToast` 反馈、图标按钮等。

### 8.1 GitHub 连接入口

**位置**：Settings → **GitHub** Tab（所有用户可见）

- **未连接**：展示“Connect to GitHub”按钮 + 说明文案。
- **已连接**：展示 GitHub 头像 + 用户名 + “Disconnect”按钮。
- 连接状态持久化于 `github_connections` 表。

### 8.2 仓库导入

**入口**：Sidebar 项目列表区 “+” 按钮（现有 Create Project）旁新增 **Import from GitHub** 选项。

**导入弹窗**（`ConsoleDialogShell`，md 档位）：

1. **仓库选择**：搜索框 + 仓库列表（名称、可见性、最后更新时间、语言）。
2. **配置**：
   - 项目名称（默认 = repo name）。
   - 基础分支（默认 = default branch）。
   - 工作分支名称（默认 = `xensemble/<timestamp>`）。
   - ✅ 自动创建工作分支。
3. **确认**：Import 按钮。

### 8.3 分支管理

**位置**：Session 终端工具栏，Branch selector 下拉。

- 当前分支名称 + 状态指示器（dirty/clean, ahead/behind）。
- 下拉：切换分支、创建新分支、从 upstream 合并。
- 当分支有未提交更改时切换分支，提示 stash 或 commit。

### 8.4 Git 状态栏

**位置**：Session 区域底部（终端下方）。

```
┌──────────────────────────────────────────────────────────────┐
│  🔀 xensemble/dev  ↑2 ↓0  │  3 modified · 1 untracked      │
│  [Commit All]  [Push]  [Pull]  [Create PR]                  │
└──────────────────────────────────────────────────────────────┘
```

- 分支名称 + ahead/behind 计数。
- 变更文件统计。
- 快捷操作按钮（图标按钮，遵循现有 `DESIGN.md` 规范）。

### 8.5 PR 创建弹窗

**弹窗**（`ConsoleDialogShell`，md 档位）：

- 源分支（自动填充当前分支，只读）。
- 目标分支（默认 = `repoDefaultBranch`，下拉可选）。
- PR 标题。
- PR 描述（`Textarea`，支持 Markdown）。
- Diff 预览区（可折叠，展示 `git diff` 摘要）。
- Create Pull Request 按钮。

创建成功后 Toast 通知，点击可跳转到 GitHub PR 页面（系统浏览器打开）。

### 8.6 PR 列表

**位置**：项目详情区 / Sidebar 项目展开项。

- 表格列：PR 编号、标题、状态（open/merged/closed）、分支、创建时间。
- 点击 PR 在系统浏览器中打开 GitHub PR 页面。
- 刷新按钮同步最新状态。

---

## 9. 安全设计

| 层面 | 措施 |
|------|------|
| **Token 存储** | GitHub access token 使用 `auth.encryptSecrets` 加密后存入 `github_connections.access_token_enc`，与现有 Secrets Vault 一致。 |
| **Token 传输** | Token 不通过 API 返回给客户端；不注入 Agent 环境变量；仅在控制面内部使用。 |
| **Git 认证** | push/pull 使用临时 credential（环境变量注入 `GIT_ASKPASS`），命令完成后清理。不在 workspace 中写入 `.git-credentials` 或 `.netrc`。 |
| **权限校验** | 所有 git 操作 API 校验用户 `active` + project 归属。仅操作用户自己的项目仓库。 |
| **OAuth state** | OAuth 流程使用 CSRF state token，绑定 user_id，5 分钟过期。 |
| **Scope 最小化** | Phase 1 请求 `repo` scope（私有仓库读写所需最小权限）。Phase 2 GitHub App 可精确到 `contents:write + pull_requests:write`。 |
| **审计** | 所有 git 操作（clone/push/PR 创建）通过 `recordEvent` 记录审计日志。 |

---

## 10. 与执行面的集成

### 10.1 Local Runtime

- `LocalExecAdapter.exec` 已支持在 workspace 目录执行命令。
- Git 操作调用 `exec('git', ['clone', ...], { cwd, env: { GIT_ASKPASS: ... } })`。
- Clone 目标 = 项目 workspace 目录。
- 路径 jail 由 `LocalFsAdapter` / `workspace.resolveSafePath` 保证。

### 10.2 BoxLite / K8s Runtime

- Git 命令通过对应 `ExecAdapter.exec` 在 sandbox/pod 内执行。
- 需确认 runtime 环境中已安装 `git`。
- Credential 通过 env 注入，不持久化到 volume/镜像。

### 10.3 ExecAdapter 接口

现有 `ExecAdapter` 接口已定义 `exec` 方法（短期任务执行，非 PTY），用于 git 命令。当前 Local 实现中 `exec` 已存在；BoxLite/K8s 占位需后续实现。

```js
// server/src/runtime/interfaces.js
class ExecAdapter {
  spawn(cmd, args, env, opts) { ... }  // PTY，长期
  exec(cmd, args, env, opts) { ... }   // 短期命令执行（git, npm 等）
}
```

---

## 11. 异步操作与进度

### 11.1 Clone 进度

Clone 可能耗时较长（大仓库），需异步处理：

1. `POST /api/v1/projects/import-github` 立即返回，`clone_status: 'cloning'`。
2. 后台通过 `ExecAdapter.exec` 执行 `git clone`。
3. Desktop Client 通过 **API 轮询**获取进度，每 **2 秒**调用 `GET /api/v1/projects/:id` 读取 `clone_status` / `clone_error` 字段。
4. 后台也可推送 WS 事件 `project.clone_progress` / `project.clone_complete` 作为补充，但 Phase 1 以轮询为主，避免 WS 连接未建立时丢失进度。

`clone_status` 取值：`pending` / `cloning` / `ready` / `failed`。

### 11.2 Push/Pull

Push/pull 一般较快，使用同步 API + 超时。如果 push 涉及大量数据，返回 `202 Accepted` + 轮询。

---

## 12. 迁移路径

### Phase 1 — GitHub OAuth + 导入 + 分支 + PR（当前设计范围）

1. **数据模型**：新增 `github_connections`、`project_branches`、`pull_requests` 表；扩展 `projects` 表字段。
2. **Server 服务**：实现 `GitHubService`、`GitConnectionService`、`GitOperationService`、`PullRequestService`。
3. **API 路由**：注册 `/api/v1/github/*`、扩展 `/api/v1/projects/*/git/*`、`/api/v1/projects/*/branches`、`/api/v1/projects/*/pull-requests`。
4. **Desktop UI**：GitHub Settings 面板、仓库导入弹窗、Branch selector、Git 状态栏、PR 创建弹窗。
5. **Admin 配置**：Settings → GitHub（OAuth App 配置）。

### Phase 2 — GitHub App + Webhook

1. 支持 GitHub App installation 方式。
2. 接收 Webhook 事件（PR review、merge、push）。
3. PR 状态自动同步（无需手动刷新）。
4. 组织级仓库管理。

### Phase 3 — 多平台 Git Provider

1. 抽象 `GitProviderService` 接口。
2. 实现 `GitLabService`、`BitbucketService`。
3. 统一 UI 中选择 Git 平台。

### Phase 4 — 高级 Git 功能

1. 冲突解决 UI（Desktop 端可视化 merge conflict 处理）。
2. Git blame / history 可视化。
3. Branch 保护规则展示。
4. Code review 集成（在 Desktop 中查看 PR review 状态和评论）。

---

## 13. 与 Agent 的协同

### 13.1 Agent 感知 Git 分支

当 Agent session 启动时，spawn 环境注入：

```
XENSEMBLE_GIT_BRANCH=xensemble/dev       # 当前工作分支
XENSEMBLE_GIT_BASE_BRANCH=main           # 基础分支
XENSEMBLE_REPO_URL=owner/repo            # 仓库标识
```

Agent（如 kimi-code）可利用这些信息在 commit message 中引用分支，或在对话中提及当前上下文。

### 13.2 Agent 自动 Commit

Agent session 退出时（或用户手动触发），平台可自动执行 checkpoint commit：

```bash
git add -A
git commit -m "session/<session_id>: agent work checkpoint"
```

约束：

- **默认开启**：新项目 `auto_commit_on_exit = true`。
- **仅在有变更时执行**：先检查 `git status`，workspace 干净时跳过。
- **不自动 push**：commit 只写本地仓库，push 必须由用户显式触发。
- **失败不阻断 session 退出**：commit 失败记录事件和 `clone_error` 类日志，不影响 session 关闭。

保证 Agent 的工作不丢失，同时避免污染远端分支。

### 13.3 Agent 不直接 push

Agent 进程不拥有 GitHub token，**不能**直接 push 到远端。Push 操作必须由用户通过 Desktop UI 或 API 显式触发（经控制面注入临时凭据执行）。这保证了：

- 用户对推送到 GitHub 的内容有最终控制权。
- Agent 无法绕过审查直接修改远端仓库。

---

## 14. `.xensemble/` Workspace 目录结构

每个 Git workspace 根目录下维护一个 `.xensemble/` 子目录，用于存放 XEnsemble 平台专属配置与 Agent 上下文，**默认不提交到上游仓库**。

```
<project-root>/
  .xensemble/
  ├── .gitignore               # 忽略自身全部内容，避免污染上游
  ├── config.json              # 项目级配置（auto_commit_on_exit、base_branch 等）
  ├── rules/
  │   └── default.md           # Agent 规则/约束说明
  ├── memory/
  │   └── session_<id>.md      # 当前 session 记忆/上下文（可选）
  ├── prompts/
  │   └── pr_description.md    # PR 描述模板等可复用 prompt
  ├── workflows/
  │   └── onboarding.yaml      # 项目自定义工作流（Phase 2+）
  └── cache/
      └── ...                  # 临时缓存，随时可清理
```

### 14.1 `.xensemble/.gitignore`

导入仓库时自动生成：

```gitignore
# XEnsemble workspace metadata — do not commit
*
!.gitignore
```

该文件确保 `.xensemble/` 目录下的所有内容都不会被推送到 GitHub。

### 14.2 `config.json`

```json
{
  "version": 1,
  "auto_commit_on_exit": true,
  "base_branch": "main",
  "default_work_branch_prefix": "xensemble/"
}
```

- `auto_commit_on_exit`：Agent session 退出时是否自动 checkpoint commit。
- `base_branch`：工作分支的默认 base。
- `default_work_branch_prefix`：自动创建工作分支时的前缀。

### 14.3 与现有 RepositoryEnvironmentService 的关系

- `.xensemble/` 由 `RepositoryEnvironmentService` 在 clone/import 后 scaffold。
- 配置变更同步写入 `config.json` 和 `projects` 表（以 DB 为准，config.json 为本地缓存/Agent 可读）。
- 删除项目时由 `deleteProject.js` 一并清理 workspace 目录，无需单独处理 `.xensemble/`。

---

## 15. 配额扩展

| 维度 | 说明 |
|------|------|
| `max_github_repos` | 可导入的 GitHub 仓库数量限制（复用 `max_projects`） |
| `max_prs_per_day` | 每日 PR 创建限额（可选，防止滥用） |

Phase 1 复用现有 `max_projects` 配额，不新增维度。

---

## 16. 与现有代码库的对齐

| 设计点 | 现有实现 | 对齐方式 |
|--------|----------|----------|
| Token 加密 | `server/src/auth/index.js` 提供 `encryptSecrets`/`decryptSecrets` | GitHub token 直接复用 |
| 项目元数据 | `projects` 表已有 `repoProvider`/`repoUrl`/`repoDefaultBranch` 等字段 | 仅新增 `current_branch`/`github_repo_id`/`github_full_name` |
| 短命令执行 | `LocalExecAdapter.exec` 已可用；接口在 `ExecAdapter` 中定义 | Git 操作统一走 `runtime.exec.exec(...)` |
| 路由注册 | `server/src/routes/*.js` + `server/src/server.js` 注册 | 新增 `routes/github.js`，或拆分 `routes/projects-git.js` |
| 审计 | `server/src/events/recordEvent.js` | 所有写操作调用 `recordEvent` |
| 平台配置 | `server/src/admin/PlatformSettings.js` | GitHub OAuth App 配置存 `platform_settings` |
| 测试 | `node --test` + `node:assert` | 新增 `server/src/github/*.test.js` |

---

## 17. 相关文档

- 系统架构：`docs/Architecture.md`
- 客户端 API：`docs/ApiClient.md`
- UI 规范：`DESIGN.md` → `docs/Designs.md`
- 仓库快照/检查点：`server/src/repositories/RepositoryEnvironmentService.js`
- Agent 说明：`docs/agents.md`
- 用户/配额：`docs/UserManagement.md`

---

## 附录 A：GitHub OAuth App 创建详述

### A.1 创建入口

1. 使用管理员个人账号或组织账号登录 GitHub。
2. 右上角头像 → **Settings** → 左侧最下方 **Developer settings**。
3. 选择 **OAuth Apps** → 点击 **New OAuth App**。

### A.2 必填字段

| 字段 | 示例值 | 说明 |
|------|--------|------|
| Application name | `XEnsemble` | 用户授权页展示的应用名，可自定义。 |
| Homepage URL | `https://xensemble.dev` | 控制面公网地址，与 `CONTROL_PLANE_PUBLIC_URL` 一致。 |
| Application description | 可选 | 授权页展示给用户看的说明。 |
| Authorization callback URL | `https://xensemble.dev/api/v1/github/callback` | 必须与 `GITHUB_CALLBACK_URL` 配置完全一致。 |
| Enable Device Flow | 不勾选 | Phase 1 不使用 device flow。 |

### A.3 获取凭证

创建成功后进入 App 详情页：

- **Client ID**：一串 20 字符的字母数字，公开，填入 `GITHUB_CLIENT_ID`。
- **Client secrets** → **Generate a new client secret**：生成后只显示一次，填入 `GITHUB_CLIENT_SECRET`。

### A.4 验证授权页

在浏览器访问：

```
https://github.com/login/oauth/authorize?client_id=<CLIENT_ID>&redirect_uri=<CALLBACK_URL>&scope=repo&state=test
```

应正常跳转到 GitHub 授权页；授权后重定向回 XEnsemble 回调地址。
