# GitHub 工作流集成设计

> 状态：设计草案  
> 日期：2026-06-22  
> 适用范围：`server/` 控制面、`desktop/` Desktop Client、`client/` Web 管理面  
> 依赖：`docs/Architecture.md`（执行面三层 Provider）、`docs/ApiClient.md`（REST/WS 协议）

---

## 1. 设计目标

支持用户将 GitHub 仓库导入 XEnsemble，在 Agent workspace 内的 Git 分支上进行开发，并直接从平台提交 PR 回 GitHub——形成完整的「Import → Branch → Develop → PR」开发闭环，类似 Devin 的工作模式。

### 1.1 核心用户故事

1. **导入仓库**：用户在 Desktop Client 中连接 GitHub 账号，选择一个 GitHub 仓库导入为 XEnsemble 项目，系统自动 clone 到 workspace。
2. **分支开发**：Agent session 在独立分支上工作（自动创建或用户指定），不影响主分支。
3. **提交 PR**：开发完成后，用户在 Desktop Client 中一键将当前分支提交为 GitHub PR，填写标题和描述。
4. **同步与更新**：用户可以从上游主分支拉取最新代码合并到工作分支，保持同步。
5. **多仓库管理**：用户可以同时管理多个已导入的 GitHub 项目，查看分支/PR 状态。

### 1.2 非目标（Phase 1）

- GitHub App marketplace 发布（先使用 OAuth App 或自建 GitHub App）
- Webhook 驱动的实时 PR 事件同步（先使用轮询 + 用户触发刷新）
- 代码 Review 界面（用户在 GitHub 上完成 Review）
- 支持 GitLab、Bitbucket 等其他 Git 平台（架构预留抽象，但不实现）
- GitHub Actions CI/CD 集成

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

**关键设计决策：**

- **Git 操作在 Runtime 侧执行**：clone/pull/push/branch 等 git 命令通过 `ExecAdapter` 在 workspace 所在的执行环境中运行（Local、BoxLite、K8s 均适用）。控制面只负责编排、鉴权和状态记录。
- **GitHub API 调用在控制面**：OAuth token 管理、GitHub REST API（仓库列表、PR 创建/查询）在控制面执行，token 不注入 agent 环境。
- **Git 认证通过临时凭据**：push/pull 时，控制面签发短期 credential（git credential helper 或 token URL），避免长期 token 落地到 workspace。

---

## 3. GitHub 认证

### 3.1 GitHub OAuth App（Phase 1）

使用 GitHub OAuth App 获取用户级 access token，权限范围 `repo`（私有仓库读写）。

#### 3.1.1 创建 GitHub OAuth App

> 以下步骤指导 Admin 在 GitHub 上创建 OAuth App。

1. 登录 GitHub → 进入 **Settings → Developer settings → OAuth Apps → New OAuth App**
   - 直达链接：<https://github.com/settings/applications/new>
2. 填写表单：

| 字段 | 值 | 说明 |
|------|-----|------|
| Application name | `XEnsemble` | 用户授权时看到的名称 |
| Homepage URL | `https://your-domain.com` | XEnsemble 公网地址或文档页 |
| Authorization callback URL | `https://your-domain.com/api/v1/github/callback` | **必须与 Server `GITHUB_CALLBACK_URL` 一致** |

3. 点击 **Register application**，进入 App 详情页：
   - 复制 **Client ID** → 填入 XEnsemble Settings → GitHub → `GITHUB_CLIENT_ID`
   - 点击 **Generate a new client secret** → 复制 → 填入 `GITHUB_CLIENT_SECRET`
   - Client Secret 只展示一次，请立即保存
4. （可选）上传 Logo，设置 App 描述

> **GitHub Enterprise Server**：将上述 `github.com` 替换为 GHE 域名，同时在 Settings 中配置 `GITHUB_API_BASE = https://ghe.corp.com/api/v3`。

#### 3.1.2 OAuth 流程（轮询模式）

```
Desktop Client                   Server                        GitHub
     │                              │                              │
     │  1. POST /github/connect     │                              │
     │  ← { auth_url, poll_id }     │                              │
     │                              │                              │
     │  2. 打开系统浏览器             │                              │
     │  → github.com/login/oauth    │                              │
     │     ?client_id=...           │                              │
     │     &redirect_uri=server/cb  │                              │
     │     &scope=repo              │                              │
     │     &state=<poll_id>         │                              │
     │                              │                              │
     │                              │  3. 用户授权后 GitHub 回调     │
     │                              │  ← GET /github/callback       │
     │                              │     ?code=...&state=...       │
     │                              │                              │
     │                              │  4. Server 用 code 换 token   │
     │                              │  → POST github.com/access_token
     │                              │  ← access_token              │
     │                              │                              │
     │                              │  5. 加密存储 token，标记完成   │
     │                              │  → github_connections 表      │
     │                              │  → 返回 HTML「请返回 Desktop」 │
     │                              │                              │
     │  6. Desktop 轮询（2s 间隔）   │                              │
     │  GET /github/connection       │                              │
     │  ← { connected: true, ... }  │                              │
```

Desktop Client **不使用**自定义协议（`xensemble://`），而是采用 **Server 回调 + Desktop 轮询** 模式：

1. Desktop 调用 `POST /api/v1/github/connect` 获取 `auth_url` 和 `poll_id`
2. 调用 `shell.openExternal(auth_url)` 在系统浏览器中打开 GitHub 授权页
3. Server 的 `GET /api/v1/github/callback` 完成 code→token 交换后，返回 HTML 页面提示"授权成功，请返回 XEnsemble Desktop"
4. Desktop 以 2s 间隔轮询 `GET /api/v1/github/connection`，检测 `connected: true` 后停止轮询，更新 UI
5. 轮询超时 5 分钟后放弃，提示用户重试

### 3.2 GitHub App 方案（Phase 2）

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

存储在 `platform_settings` 表，secret 类字段使用现有 `auth.encryptSecrets` 加密。

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

已有字段可直接复用：

| 字段 | 用途 |
|------|------|
| `repoProvider` | 设为 `'github'` |
| `repoUrl` | GitHub HTTPS clone URL |
| `repoDefaultBranch` | `'main'` 或 `'master'` |
| `repoInstallationRef` | GitHub App installation ID（Phase 2） |
| `repoTokenSecretRef` | 指向 `github_connections.id` |
| `workspaceMode` | 设为 `'git'` |
| `lastSyncSha` | 最近一次 sync 的 commit SHA |

新增字段：

```sql
ALTER TABLE projects ADD COLUMN current_branch TEXT;     -- workspace 当前分支
ALTER TABLE projects ADD COLUMN github_repo_id INTEGER;  -- GitHub repo numeric ID
ALTER TABLE projects ADD COLUMN github_full_name TEXT;   -- 'owner/repo'
```

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
  ├─ generateGitCredential(token) → { username, password, expires_at }
  └─ revokeToken(token) → void
```

- 所有方法接收解密后的 token，由调用方负责解密。
- HTTP client 使用 `undici` 或 Node.js 内置 `fetch`。
- 错误码映射：`401 → token_expired`、`403 → insufficient_scope`、`404 → repo_not_found`。

### 5.2 GitOperationService（控制面 + 执行面协同）

`server/src/github/GitOperationService.js`

编排 Git 操作：控制面准备凭据和状态，通过 `ExecAdapter` 在 Runtime 中执行 git 命令。

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

```
1. 控制面解密 github_connections.access_token_enc → plaintext token
2. 构造 credential helper 脚本:
   GIT_ASKPASS=/tmp/xe-credential-<random>.sh
   脚本内容: echo "<token>"
   或使用 URL 方式: https://x-access-token:<token>@github.com/owner/repo.git
3. 通过 ExecAdapter.exec 执行 git push/pull，注入 env:
   GIT_ASKPASS=... 或 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper ...
4. 命令完成后删除临时凭据文件
```

对 BoxLite/K8s Runtime：凭据通过 ExecAdapter.exec 的 env 参数传入，不持久化到 workspace。

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
  ├─ completeOAuth(userId, code, state) → connection record
  ├─ getConnection(userId) → connection | null
  ├─ refreshConnection(userId) → updated connection  // OAuth App 无 refresh；仅验证 token 有效性
  ├─ disconnect(userId) → void  // revoke + soft delete
  └─ getDecryptedToken(userId) → plaintext token (内部方法)
```

---

## 6. API 端点

### 6.1 GitHub 连接

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/github/connection` | 获取当前用户的 GitHub 连接状态（不含 token） |
| POST | `/api/v1/github/connect` | 发起 OAuth，返回 `{ auth_url }` |
| GET | `/api/v1/github/callback?code=&state=` | OAuth 回调（Server 处理后重定向或返回 HTML） |
| POST | `/api/v1/github/callback` | Desktop Client POST 方式完成 OAuth code 交换 |
| DELETE | `/api/v1/github/connection` | 断开 GitHub 连接，撤销 token |
| GET | `/api/v1/github/repos` | 列出用户可见的 GitHub 仓库（带分页/搜索） |
| GET | `/api/v1/github/repos/:owner/:repo` | 获取单个仓库详情 |

### 6.2 项目仓库操作

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/projects/import-github` | 导入 GitHub 仓库为新项目 |
| POST | `/api/v1/projects/:id/git/clone` | 对已有项目执行初始 clone |
| GET | `/api/v1/projects/:id/git/clone-status` | 轮询 clone 进度（2s 间隔） |
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

Clone 为异步操作（大仓库耗时较长），Desktop Client 通过**轮询** `GET /api/v1/projects/:id/git/clone-status` 获取进度。

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
  └─ github.js                   # GitHub 相关路由注册
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

### 8.1 GitHub 连接入口

**位置**：Settings → **GitHub** Tab（所有用户可见）

- **未连接**：展示"Connect to GitHub"按钮 + 说明文案
- **已连接**：展示 GitHub 头像 + 用户名 + "Disconnect"按钮
- 连接状态持久化于 `github_connections` 表

### 8.2 仓库导入

**入口**：Sidebar 项目列表区 "+" 按钮（现有 Create Project）旁新增 **Import from GitHub** 选项

**导入弹窗**（`ConsoleDialogShell`，md 档位）：

1. **仓库选择**：搜索框 + 仓库列表（名称、可见性、最后更新时间、语言）
2. **配置**：
   - 项目名称（默认 = repo name）
   - 基础分支（默认 = default branch）
   - 工作分支名称（默认 = `xensemble/<timestamp>`）
   - ✅ 自动创建工作分支
3. **确认**：Import 按钮

### 8.3 分支管理

**位置**：Session 终端工具栏，Branch selector 下拉

- 当前分支名称 + 状态指示器（dirty/clean, ahead/behind）
- 下拉：切换分支、创建新分支、从 upstream 合并
- 当分支有未提交更改时切换分支，提示 stash 或 commit

### 8.4 Git 状态栏

**位置**：Session 区域底部（终端下方）

```
┌──────────────────────────────────────────────────────────────┐
│  🔀 xensemble/dev  ↑2 ↓0  │  3 modified · 1 untracked      │
│  [Commit All]  [Push]  [Pull]  [Create PR]                  │
└──────────────────────────────────────────────────────────────┘
```

- 分支名称 + ahead/behind 计数
- 变更文件统计
- 快捷操作按钮（图标按钮，遵循现有 DESIGN.md 规范）

### 8.5 PR 创建弹窗

**弹窗**（`ConsoleDialogShell`，md 档位）：

- 源分支（自动填充当前分支，只读）
- 目标分支（默认 = `repoDefaultBranch`，下拉可选）
- PR 标题
- PR 描述（`Textarea`，支持 Markdown）
- Diff 预览区（可折叠，展示 `git diff` 摘要）
- Create Pull Request 按钮

创建成功后 Toast 通知，点击可跳转到 GitHub PR 页面（系统浏览器打开）。

### 8.6 PR 列表

**位置**：项目详情区 / Sidebar 项目展开项

- 表格列：PR 编号、标题、状态（open/merged/closed）、分支、创建时间
- 点击 PR 在系统浏览器中打开 GitHub PR 页面
- 刷新按钮同步最新状态

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
- 路径 jail 由 `LocalFsAdapter` 保证。

### 10.2 BoxLite / K8s Runtime

- Git 命令通过对应 `ExecAdapter.exec` 在 sandbox/pod 内执行。
- 需确认 runtime 环境中已安装 `git`。
- Credential 通过 env 注入，不持久化到 volume/镜像。

### 10.3 ExecAdapter 接口扩展

现有 `ExecAdapter` 接口需要 `exec` 方法（短期任务执行，非 PTY），用于 git 命令。当前 Local 实现中 `exec` 已存在（`LocalExecAdapter.exec`），BoxLite/K8s 占位需后续实现。

```js
// 已有接口（interfaces.js）
class ExecAdapter {
  spawn(cmd, args, env, opts) { ... }  // PTY，长期
  exec(cmd, args, opts) { ... }        // 短期命令执行（git, npm 等）
}
```

---

## 11. 异步操作与进度

### 11.1 Clone 进度（轮询模式）

Clone 可能耗时较长（大仓库），采用 **异步执行 + API 轮询** 模式：

1. `POST /api/v1/projects/import-github` 立即返回 `{ id, clone_status: 'cloning' }`
2. 后台通过 `ExecAdapter.exec` 执行 `git clone --progress`，解析 stderr 进度输出
3. 进度写入内存（或临时 DB 字段 `projects.clone_progress_json`）
4. Desktop Client 以 **2s 间隔** 轮询 clone 状态：

```http
GET /api/v1/projects/:id/git/clone-status
Authorization: Bearer <jwt>
```

响应：

```json
{
  "clone_status": "cloning",
  "phase": "receiving",
  "progress": 65,
  "message": "Receiving objects: 65% (1200/1846)",
  "error": null
}
```

5. `clone_status` 变为 `ready` 或 `error` 后 Desktop 停止轮询
6. 完成后初始化 `.xensemble/` 目录结构（见 §14）

### 11.2 Push/Pull

Push/pull 一般较快，使用同步 API + 超时（30s）。超时返回 `408 Request Timeout`，客户端可重试。

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

### 13.2 Agent 自动 Commit（默认开启）

Agent session 退出时，平台**自动执行**：

```bash
cd <workspace>
git add -A
git diff --cached --quiet || git commit -m "chore(xensemble): session <session_id> auto-checkpoint"
```

- **默认开启**，通过项目设置 `auto_commit_on_exit: true` 控制。
- 仅在有实际变更时 commit（`git diff --cached --quiet` 检测）。
- commit message 格式固定，包含 session ID 便于追溯。
- 用户随后可通过 Desktop UI 手动 push 或创建 PR。
- 自动 commit 不触发 push——保证用户对远端推送的最终控制权。

实现位置：`sessionManager.onExit` 回调中，在标记 session 为 `exited` 之前执行。

### 13.3 Agent 不直接 push

Agent 进程不拥有 GitHub token，**不能**直接 push 到远端。Push 操作必须由用户通过 Desktop UI 或 API 显式触发（经控制面注入临时凭据执行）。这保证了：

- 用户对推送到 GitHub 的内容有最终控制权。
- Agent 无法绕过审查直接修改远端仓库。

---

## 14. Workspace 目录结构

导入的 GitHub 仓库以**真实 Git 仓库**形式存在于 workspace 中，同时包含一个 `.xensemble/` 目录用于存储平台元数据。用户可以像在个人电脑上一样进行本地 Git 操作。

### 14.1 目录布局

```
<workspace_root>/                     # = projects.serverPath
├── .git/                             # 标准 Git 目录（clone 产生）
├── .gitignore                        # 仓库原有 + 追加 .xensemble/ 条目
├── .xensemble/                       # XEnsemble 平台元数据目录
│   ├── config.json                   # 项目级配置
│   ├── rules/                        # Agent 规则文件
│   │   ├── default.md                # 默认规则（平台 scaffold）
│   │   └── *.md                      # 用户自定义规则
│   ├── memory/                       # Agent 记忆 / 上下文持久化
│   │   ├── sessions/                 # 按 session 归档
│   │   │   └── <session_id>.json     # session 对话摘要 / 关键决策
│   │   └── project.json              # 项目级长期记忆（跨 session）
│   ├── prompts/                      # 自定义 prompt 模板
│   │   └── *.md
│   ├── workflows/                    # 自动化工作流定义（后期）
│   │   └── *.json
│   └── cache/                        # 临时缓存（不提交）
│       ├── clone_progress.json       # clone 进度缓存
│       └── git_status_cache.json     # git status 缓存
├── src/                              # 仓库源代码（示例）
├── package.json                      # 仓库原有文件
└── ...                               # 仓库其他文件
```

### 14.2 `.xensemble/config.json`

```json
{
  "version": 1,
  "project_id": "proj_abc123",
  "repo": {
    "provider": "github",
    "full_name": "owner/repo",
    "default_branch": "main"
  },
  "settings": {
    "auto_commit_on_exit": true,
    "work_branch_prefix": "xensemble/"
  }
}
```

### 14.3 `.xensemble/rules/default.md`

平台在 clone 完成后自动 scaffold 的默认规则文件：

```markdown
# XEnsemble Agent Rules

## Project Context
- Repository: {owner/repo}
- Default branch: {main}
- Working branch: {xensemble/dev}

## Guidelines
- Follow the existing code style and conventions
- Write clear commit messages
- Keep changes focused and atomic
```

用户可编辑此文件或在 `rules/` 目录下添加更多规则文件。Agent spawn 时平台读取 `rules/` 目录内容，注入 Agent 上下文。

### 14.4 Git 忽略策略

- `.xensemble/cache/` 加入 `.gitignore`（缓存文件不提交）
- `.xensemble/` 目录本身**默认加入仓库 `.gitignore`**，不推送到 GitHub
  - 原因：平台元数据是本地/平台私有的，不应污染上游仓库
  - 如果用户希望共享 rules，可手动将 `.xensemble/rules/` 从 `.gitignore` 中移除
- 实现：clone 完成后检查 `.gitignore` 是否已包含 `.xensemble/`，若无则追加

### 14.5 Scaffold 时机

`.xensemble/` 目录在以下时机创建/初始化：

1. **GitHub 仓库导入完成**（clone ready 后）
2. **新建空项目时**（`POST /api/v1/projects` 已有 scaffold 逻辑，扩展即可）
3. **目录不存在时懒初始化**（session start 时检测）

---

## 15. 配额扩展

| 维度 | 说明 |
|------|------|
| `max_github_repos` | 可导入的 GitHub 仓库数量限制（复用 `max_projects`） |
| `max_prs_per_day` | 每日 PR 创建限额（可选，防止滥用） |

Phase 1 复用现有 `max_projects` 配额，不新增维度。

---

## 16. 相关文档

- 系统架构：`docs/Architecture.md`
- 客户端 API：`docs/ApiClient.md`
- 仓库快照/检查点：`RepositoryEnvironmentService.js`
- UI 规范：`DESIGN.md` → `docs/Designs.md`
- Agent 说明：`docs/agents.md`

---

## 附录 A：GitHub OAuth App 创建完整指南

### A.1 前置条件

- 一个 GitHub 账号（个人或组织 owner/admin）
- XEnsemble Server 已部署且可公网访问（或内网 GitHub Enterprise）

### A.2 步骤详解

#### Step 1：进入 GitHub Developer Settings

1. 登录 GitHub
2. 点击右上角头像 → **Settings**
3. 左侧菜单最底部 → **Developer settings**
4. 选择 **OAuth Apps** → **New OAuth App**

> 组织级 OAuth App：进入组织 Settings → Developer settings → OAuth Apps

#### Step 2：填写 OAuth App 信息

```
Application name:              XEnsemble
Homepage URL:                  https://your-xensemble-domain.com
Application description:       AI Agent hosting platform (optional)
Authorization callback URL:    https://your-xensemble-domain.com/api/v1/github/callback
```

**关于 callback URL：**
- 必须是 HTTPS（GitHub 要求，localhost 除外）
- 必须与 XEnsemble Server 配置的 `GITHUB_CALLBACK_URL` 完全一致
- 本地开发时可用 `http://localhost:3888/api/v1/github/callback`

#### Step 3：获取凭据

注册成功后，在 App 详情页：

1. **Client ID**：直接显示，形如 `Ov23li...`
2. **Client Secret**：点击 **Generate a new client secret**
   - 生成后只显示一次，立即复制保存
   - 如果丢失，需重新生成（旧 secret 立即失效）

#### Step 4：配置到 XEnsemble

在 XEnsemble Admin Settings → GitHub 面板填入：

| 配置项 | 值 |
|--------|-----|
| GitHub Client ID | `Ov23li...`（从 Step 3 复制） |
| GitHub Client Secret | `ghs_...`（从 Step 3 复制） |
| Callback URL | `https://your-domain.com/api/v1/github/callback` |
| GitHub API Base | `https://api.github.com`（默认；GHE 填企业地址） |

或通过环境变量 / `platform_settings`：

```env
GITHUB_CLIENT_ID=Ov23li...
GITHUB_CLIENT_SECRET=ghs_...
GITHUB_CALLBACK_URL=https://your-domain.com/api/v1/github/callback
GITHUB_API_BASE=https://api.github.com
```

#### Step 5：验证

1. 在 Desktop Client Settings → GitHub 点击 **Connect to GitHub**
2. 浏览器打开 GitHub 授权页，确认权限范围为 `repo`
3. 授权后返回 Desktop，确认显示 GitHub 用户名和头像

### A.3 权限说明

| Scope | 用途 | 必需 |
|-------|------|------|
| `repo` | 读写私有/公开仓库代码、创建 PR | 是 |
| `user:email` | 获取用户邮箱（可选，用于 git commit author） | 可选 |

### A.4 安全建议

- **不要**将 Client Secret 提交到代码仓库
- 定期轮换 Client Secret（GitHub 支持同时保留两个 secret）
- 生产环境使用 HTTPS callback URL
- 考虑设置 OAuth App 的 rate limit 策略（GitHub 默认 5000 req/h per token）
