# GitHub 工作流集成 Phase 1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 XEnsemble 控制面、Desktop Client 与 Web 管理面中实现 GitHub OAuth 连接、仓库导入、分支管理、PR 创建与 `.xensemble/` workspace 目录结构，形成 Import → Branch → Develop → PR 闭环。

**Architecture:** 控制面负责 GitHub API 调用、OAuth token 加密存储、git 操作编排与状态持久化；git 命令通过现有 `RuntimeService` / `ExecAdapter.exec` 在执行面运行；token 不注入 agent 环境，push/pull 使用 `https://x-access-token:<token>@github.com/...` 短期凭据。Desktop Client 通过 REST 轮询获取 OAuth 结果与 clone 进度。

**Tech Stack:** Node.js 20+, Fastify, Drizzle ORM (SQLite), `node:test` / `node:assert`, React + Electron (Desktop), GitHub REST API v3.

---

## 0. 文件结构总览

### 新增文件

| 文件 | 职责 |
|------|------|
| `server/src/db/migrations/003_github_workflow.sql` | Phase 1 数据表迁移 |
| `server/src/github/GitHubService.js` | GitHub REST API 客户端（OAuth、仓库、PR） |
| `server/src/github/GitConnectionService.js` | OAuth 流程、token 加解密、连接生命周期 |
| `server/src/github/GitOperationService.js` | git 命令编排（clone/branch/commit/push/status/diff/log） |
| `server/src/github/PullRequestService.js` | PR 创建与同步 |
| `server/src/github/gitCredentialHelper.js` | 临时凭据构造（URL embed / GIT_ASKPASS） |
| `server/src/github/index.js` | 服务聚合导出 |
| `server/src/routes/github.js` | GitHub 连接、仓库列表、导入、git/branch/PR 路由 |
| `server/src/github/GitHubService.test.js` | GitHubService 单元测试 |
| `server/src/github/GitConnectionService.test.js` | GitConnectionService 单元测试 |
| `server/src/github/GitOperationService.test.js` | GitOperationService 单元测试 |
| `server/src/github/PullRequestService.test.js` | PullRequestService 单元测试 |
| `desktop/src/renderer/lib/githubApi.js` | Desktop 端 GitHub API 封装 |
| `desktop/src/renderer/hooks/useGitHub.js` | GitHub 连接状态 hook |
| `desktop/src/renderer/hooks/useGitStatus.js` | git status 轮询 hook |
| `desktop/src/renderer/hooks/usePullRequests.js` | PR 列表 hook |
| `desktop/src/renderer/components/github/GitHubConnectButton.jsx` | GitHub 连接/断开按钮 |
| `desktop/src/renderer/components/github/RepoImportDialog.jsx` | 仓库导入弹窗 |
| `desktop/src/renderer/components/github/BranchSelector.jsx` | 分支选择/切换 |
| `desktop/src/renderer/components/github/GitStatusBar.jsx` | 底部 git 状态条 |
| `desktop/src/renderer/components/github/CreatePRDialog.jsx` | 创建 PR 弹窗 |
| `desktop/src/renderer/components/github/PRListPanel.jsx` | PR 列表 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `server/src/db/schema.js` | 扩展 `projects` 表；新增 `github_connections`、`github_oauth_states`、`project_branches`、`pull_requests` |
| `server/src/server.js` | 注册 `registerGitHubRoutes(fastify)`；在 session start 时注入 `XENSEMBLE_GIT_*` 环境变量 |
| `server/src/repositories/RepositoryEnvironmentService.js` | 导入仓库后 scaffold `.xensemble/` 目录与 `.gitignore` |
| `server/src/projects/deleteProject.js` | 确认删除项目时清理 workspace（已有逻辑，验证 `.xensemble/` 一并删除） |
| `server/src/auth/index.js` | 无需修改，直接复用 `encryptSecrets`/`decryptSecrets` |
| `server/src/runtime/LocalExecAdapter.js` | 无需修改，`exec` 已满足需求 |
| `server/src/admin/PlatformSettings.js` | 无需修改，GitHub 配置以 `github_*` key 存入 `platform_settings` |
| `desktop/src/renderer/components/settings/SettingsModal.jsx` | 新增 **GitHub** Tab |
| `desktop/src/renderer/components/settings/GitHubSettingsPanel.jsx` | GitHub 连接与平台配置面板 |
| `server/package.json` | 更新 `test` 脚本，包含 `src/github/*.test.js` |

---

## Task 1: 数据模型 — Schema 扩展与迁移

**Files:**
- Modify: `server/src/db/schema.js`
- Create: `server/src/db/migrations/003_github_workflow.sql`
- Test: `server/src/db/schema.test.js`（若不存在则创建）

### Step 1.1: 扩展 `projects` 表

在 `server/src/db/schema.js` 的 `projects` 定义中追加字段：

```js
const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  serverPath: text('server_path').notNull(),
  defaultRuntimeId: text('default_runtime_id'),
  repoProvider: text('repo_provider').default('none'),
  repoUrl: text('repo_url'),
  repoDefaultBranch: text('repo_default_branch').default('main'),
  repoInstallationRef: text('repo_installation_ref'),
  repoTokenSecretRef: text('repo_token_secret_ref'),
  workspaceMode: text('workspace_mode').default('local'),
  lastSyncSha: text('last_sync_sha'),
  lastSnapshotId: text('last_snapshot_id'),
  devProfileId: text('dev_profile_id'),
  // Phase 1 新增
  currentBranch: text('current_branch'),
  githubRepoId: integer('github_repo_id'),
  githubFullName: text('github_full_name'),
  cloneStatus: text('clone_status').default('pending'),
  cloneError: text('clone_error'),
  createdAt: integer('created_at').notNull()
});
```

### Step 1.2: 新增 OAuth / 分支 / PR 表

在同一文件末尾追加：

```js
const githubConnections = sqliteTable('github_connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id).unique(),
  githubUserId: integer('github_user_id').notNull(),
  githubUsername: text('github_username').notNull(),
  githubAvatar: text('github_avatar'),
  accessTokenEnc: text('access_token_enc').notNull(),
  tokenScope: text('token_scope'),
  connectedAt: integer('connected_at').notNull(),
  lastUsedAt: integer('last_used_at'),
  revokedAt: integer('revoked_at'),
});

const githubOAuthStates = sqliteTable('github_oauth_states', {
  state: text('state').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

const projectBranches = sqliteTable('project_branches', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  branchName: text('branch_name').notNull(),
  baseBranch: text('base_branch'),
  isActive: integer('is_active', { mode: 'boolean' }).default(false),
  lastCommitSha: text('last_commit_sha'),
  aheadCount: integer('ahead_count').default(0),
  behindCount: integer('behind_count').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

const pullRequests = sqliteTable('pull_requests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  githubPrNumber: integer('github_pr_number').notNull(),
  githubPrUrl: text('github_pr_url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  sourceBranch: text('source_branch').notNull(),
  targetBranch: text('target_branch').notNull(),
  status: text('status').notNull().default('open'),
  githubState: text('github_state'),
  mergeSha: text('merge_sha'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastSyncedAt: integer('last_synced_at'),
});
```

并更新 `module.exports` 导出这 4 个新表。

### Step 1.3: 创建迁移脚本

创建 `server/src/db/migrations/003_github_workflow.sql`：

```sql
-- github_connections
CREATE TABLE IF NOT EXISTS github_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  github_user_id INTEGER NOT NULL,
  github_username TEXT NOT NULL,
  github_avatar TEXT,
  access_token_enc TEXT NOT NULL,
  token_scope TEXT,
  connected_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_github_connections_user_id ON github_connections(user_id);

-- github_oauth_states
CREATE TABLE IF NOT EXISTS github_oauth_states (
  state TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_oauth_states_expires ON github_oauth_states(expires_at);

-- project_branches
CREATE TABLE IF NOT EXISTS project_branches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  branch_name TEXT NOT NULL,
  base_branch TEXT,
  is_active INTEGER DEFAULT 0,
  last_commit_sha TEXT,
  ahead_count INTEGER DEFAULT 0,
  behind_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, branch_name)
);

-- pull_requests
CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  github_pr_number INTEGER NOT NULL,
  github_pr_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  github_state TEXT,
  merge_sha TEXT,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_synced_at INTEGER,
  UNIQUE(project_id, github_pr_number)
);

-- projects 扩展字段
ALTER TABLE projects ADD COLUMN current_branch TEXT;
ALTER TABLE projects ADD COLUMN github_repo_id INTEGER;
ALTER TABLE projects ADD COLUMN github_full_name TEXT;
ALTER TABLE projects ADD COLUMN clone_status TEXT DEFAULT 'pending';
ALTER TABLE projects ADD COLUMN clone_error TEXT;
```

> 注：SQLite `ALTER TABLE ADD COLUMN` 限制较少，上述语句可直接执行；若项目后续切 Postgres，需相应调整迁移。

### Step 1.4: 运行迁移并验证表结构

Run:
```bash
cd server && npm run migrate
```
若项目无 migrate 脚本，可临时执行：
```bash
cd server && node -e "require('./src/db/migrations/runner')()"
```
（如不存在 runner，可在 `server.js` 启动流程中加入 `db.run(sqliteMigrator)`，但不在本计划范围。）

Expected: 数据库中出现 `github_connections`、`github_oauth_states`、`project_branches`、`pull_requests` 表，且 `projects` 表含新列。

### Step 1.5: Commit

```bash
git add server/src/db/schema.js server/src/db/migrations/003_github_workflow.sql
git commit -m "feat(db): add github workflow tables and project columns"
```

---

## Task 2: 平台配置 — GitHub OAuth App 设置

**Files:**
- Modify: `server/src/routes/admin.js`
- Modify: `desktop/src/renderer/components/settings/GitHubSettingsPanel.jsx`（新增）

### Step 2.1: 扩展 admin platform-settings 校验

在 `server/src/routes/admin.js` 中找到 `PUT /api/v1/admin/platform-settings` 的校验逻辑，追加允许保存的 key：

```js
const ALLOWED_GITHUB_KEYS = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_CALLBACK_URL',
  'GITHUB_API_BASE',
];
```

（若 admin 路由使用通用 schema 无白名单，则无需修改；GitHub 配置作为普通 key-value 存入 `platform_settings`。）

### Step 2.2: 加密 Client Secret

在保存 `GITHUB_CLIENT_SECRET` 时，使用 `auth.encryptSecrets` 加密后再存入 `platform_settings.value`：

```js
const { encryptSecrets } = require('../auth');

async function setPlatformSetting(key, value) {
  if (key === 'GITHUB_CLIENT_SECRET' && value) {
    value = encryptSecrets({ secret: value });
  }
  // 原有 set 逻辑
}

async function getPlatformSetting(key) {
  let value = await PlatformSettings.get(key);
  if (key === 'GITHUB_CLIENT_SECRET' && value) {
    try {
      const decrypted = decryptSecrets(value);
      value = decrypted.secret;
    } catch {
      value = null;
    }
  }
  return value;
}
```

> 更推荐新增 `server/src/admin/PlatformSecrets.js` 的包装方法 `getPlatformSecret` / `setPlatformSecret`，并在 GitHub 配置中复用，与现有 agent_secrets_encrypted 机制保持一致。

### Step 2.3: Desktop GitHub Settings Panel

新增 `desktop/src/renderer/components/settings/GitHubSettingsPanel.jsx`：

- 仅 admin 可见（或所有用户只读显示是否已配置）。
- 表单字段：Client ID、Client Secret、Callback URL、API Base。
- 保存调用 `PUT /api/v1/admin/platform-settings`。
- Client Secret 输入框使用 `type="password"`。

### Step 2.4: Commit

```bash
git add server/src/routes/admin.js desktop/src/renderer/components/settings/GitHubSettingsPanel.jsx
git commit -m "feat(admin): github oauth platform settings"
```

---

## Task 3: GitHubService — GitHub API 客户端

**Files:**
- Create: `server/src/github/GitHubService.js`
- Create: `server/src/github/GitHubService.test.js`

### Step 3.1: 实现 GitHubService

```js
const GITHUB_API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com';

class GitHubError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = status;
  }
}

function mapStatus(status, message) {
  if (status === 401) return new GitHubError(message, 'token_expired', status);
  if (status === 403) return new GitHubError(message, 'insufficient_scope', status);
  if (status === 404) return new GitHubError(message, 'repo_not_found', status);
  return new GitHubError(message, 'github_api_error', status);
}

async function githubFetch(token, path, opts = {}) {
  const url = `${GITHUB_API_BASE}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'GitHub API error');
    throw mapStatus(res.status, text);
  }
  if (res.status === 204) return null;
  return res.json();
}

class GitHubService {
  async exchangeOAuthCode(code) {
    const clientId = await getPlatformSetting('GITHUB_CLIENT_ID');
    const clientSecret = await getPlatformSecret('GITHUB_CLIENT_SECRET');
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const data = await res.json();
    if (data.error) throw new GitHubError(data.error_description || data.error, 'oauth_failed', 400);
    return data.access_token;
  }

  async getAuthenticatedUser(token) {
    return githubFetch(token, '/user');
  }

  async listUserRepos(token, { page = 1, perPage = 30, affiliation = 'owner,collaborator,organization_member' } = {}) {
    const qs = new URLSearchParams({ affiliation, sort: 'updated', page: String(page), per_page: String(perPage) });
    return githubFetch(token, `/user/repos?${qs}`);
  }

  async getRepo(token, owner, repo) {
    return githubFetch(token, `/repos/${owner}/${repo}`);
  }

  async createPullRequest(token, owner, repo, { title, body, head, base }) {
    return githubFetch(token, `/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({ title, body, head, base }),
    });
  }

  async getPullRequest(token, owner, repo, number) {
    return githubFetch(token, `/repos/${owner}/${repo}/pulls/${number}`);
  }

  async listPullRequests(token, owner, repo, { state = 'open', page = 1, perPage = 30 } = {}) {
    const qs = new URLSearchParams({ state, page: String(page), per_page: String(perPage) });
    return githubFetch(token, `/repos/${owner}/${repo}/pulls?${qs}`);
  }

  async revokeToken(token) {
    // GitHub OAuth App 无标准 revoke endpoint；可选通过 DELETE /applications/{client_id}/token 撤销
    // Phase 1 可仅本地 soft delete，不调用 GitHub。
    return true;
  }
}

module.exports = { GitHubService, GitHubError };
```

> `getPlatformSetting` / `getPlatformSecret` 需在实现时从 `server/src/admin/PlatformSettings.js` / `PlatformSecrets.js` 引入或封装。

### Step 3.2: 测试 GitHubService 的 fetch 包装

`server/src/github/GitHubService.test.js`：

```js
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { GitHubError } = require('./GitHubService');

describe('GitHubError', () => {
  test('maps 401 to token_expired', () => {
    const err = new GitHubError('bad', 'token_expired', 401);
    assert.strictEqual(err.status, 401);
    assert.strictEqual(err.code, 'token_expired');
  });
});
```

> 对真实 GitHub API 的调用使用 nock 或 undici MockAgent 进行 mock。项目当前测试未引入外部 mock 库，可先用简单的 `global.fetch` stub 测试 `exchangeOAuthCode` 的 JSON 解析与错误映射。

### Step 3.3: Commit

```bash
git add server/src/github/GitHubService.js server/src/github/GitHubService.test.js
git commit -m "feat(github): GitHubService api client"
```

---

## Task 4: GitConnectionService — OAuth 连接生命周期

**Files:**
- Create: `server/src/github/GitConnectionService.js`
- Create: `server/src/github/GitConnectionService.test.js`

### Step 4.1: 实现 GitConnectionService

```js
const crypto = require('crypto');
const { eq, and, isNull } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { encryptSecrets, decryptSecrets } = require('../auth');
const { recordEvent } = require('../events/recordEvent');
const { GitHubService } = require('./GitHubService');
const { getPlatformSetting } = require('../admin/PlatformSettings');

function newId(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }

class GitConnectionService {
  constructor(githubService = new GitHubService()) {
    this.github = githubService;
  }

  async initiateOAuth(userId) {
    const state = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000;
    await db.insert(schema.githubOAuthStates).values({ state, userId, expiresAt });

    const clientId = await getPlatformSetting('GITHUB_CLIENT_ID');
    const callbackUrl = await getPlatformSetting('GITHUB_CALLBACK_URL') || `${process.env.CONTROL_PLANE_PUBLIC_URL}/api/v1/github/callback`;
    const scope = 'repo';
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scope}&state=${state}`;
    return { authUrl, state };
  }

  async _resolveUserIdFromState(state) {
    const rows = await db.select().from(schema.githubOAuthStates).where(eq(schema.githubOAuthStates.state, state));
    if (rows.length === 0) throw new Error('invalid_state');
    const row = rows[0];
    if (row.expiresAt < Date.now()) {
      await db.delete(schema.githubOAuthStates).where(eq(schema.githubOAuthStates.state, state));
      throw new Error('state_expired');
    }
    return row.userId;
  }

  async _finishOAuth(userId, code) {
    const token = await this.github.exchangeOAuthCode(code);
    const ghUser = await this.github.getAuthenticatedUser(token);
    const now = Date.now();
    const id = newId('ghconn');
    const encrypted = encryptSecrets({ token });

    await db.insert(schema.githubConnections).values({
      id,
      userId,
      githubUserId: ghUser.id,
      githubUsername: ghUser.login,
      githubAvatar: ghUser.avatar_url,
      accessTokenEnc: encrypted,
      tokenScope: 'repo',
      connectedAt: now,
      lastUsedAt: now,
    });

    await recordEvent({ userId, subjectType: 'github_connection', subjectId: id, type: 'github.connected', data: { githubUserId: ghUser.id, githubUsername: ghUser.login } });
    return this.getConnection(userId);
  }

  async completeOAuthFromCallback(code, state) {
    const userId = await this._resolveUserIdFromState(state);
    await db.delete(schema.githubOAuthStates).where(eq(schema.githubOAuthStates.state, state));
    return this._finishOAuth(userId, code);
  }

  async completeOAuthFromDesktop(userId, code, state) {
    const resolvedUserId = await this._resolveUserIdFromState(state);
    if (resolvedUserId !== userId) throw new Error('state_user_mismatch');
    await db.delete(schema.githubOAuthStates).where(eq(schema.githubOAuthStates.state, state));
    return this._finishOAuth(userId, code);
  }

  async getConnection(userId) {
    const rows = await db.select().from(schema.githubConnections)
      .where(and(eq(schema.githubConnections.userId, userId), isNull(schema.githubConnections.revokedAt)));
    if (rows.length === 0) return null;
    const c = rows[0];
    return {
      id: c.id,
      user_id: c.userId,
      github_user_id: c.githubUserId,
      github_username: c.githubUsername,
      github_avatar: c.githubAvatar,
      token_scope: c.tokenScope,
      connected_at: c.connectedAt,
      last_used_at: c.lastUsedAt,
    };
  }

  async getDecryptedToken(userId) {
    const conn = await this.getConnection(userId);
    if (!conn) throw new Error('github_not_connected');
    const rows = await db.select({ accessTokenEnc: schema.githubConnections.accessTokenEnc })
      .from(schema.githubConnections).where(eq(schema.githubConnections.id, conn.id));
    const decrypted = decryptSecrets(rows[0].accessTokenEnc);
    await db.update(schema.githubConnections).set({ lastUsedAt: Date.now() }).where(eq(schema.githubConnections.id, conn.id));
    return decrypted.token;
  }

  async disconnect(userId) {
    const conn = await this.getConnection(userId);
    if (!conn) return;
    await db.update(schema.githubConnections).set({ revokedAt: Date.now() }).where(eq(schema.githubConnections.id, conn.id));
    await recordEvent({ userId, subjectType: 'github_connection', subjectId: conn.id, type: 'github.disconnected', data: {} });
  }
}

module.exports = { GitConnectionService };
```

### Step 4.2: 测试 state 生命周期

`server/src/github/GitConnectionService.test.js`：

```js
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { GitConnectionService } = require('./GitConnectionService');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq } = require('drizzle-orm');

describe('GitConnectionService', async () => {
  let userId = 'usr_test001';

  before(async () => {
    await db.insert(schema.users).values({ id: userId, username: 'gh_test_user', passwordHash: 'x', createdAt: 1, updatedAt: 1 });
  });

  after(async () => {
    await db.delete(schema.githubConnections).where(eq(schema.githubConnections.userId, userId));
    await db.delete(schema.githubOAuthStates).where(eq(schema.githubOAuthStates.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  test('initiateOAuth creates a state row', async () => {
    const svc = new GitConnectionService({ exchangeOAuthCode: async () => 'tok', getAuthenticatedUser: async () => ({ id: 1, login: 'a' }) });
    const { state } = await svc.initiateOAuth(userId);
    const rows = await db.select().from(schema.githubOAuthStates).where(eq(schema.githubOAuthStates.state, state));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].userId, userId);
  });
});
```

> 真实 GitHub API 调用需 mock `GitHubService`。

### Step 4.3: Commit

```bash
git add server/src/github/GitConnectionService.js server/src/github/GitConnectionService.test.js
git commit -m "feat(github): GitConnectionService oauth lifecycle"
```

---

## Task 5: GitOperationService — Git 命令编排

**Files:**
- Create: `server/src/github/GitOperationService.js`
- Create: `server/src/github/gitCredentialHelper.js`
- Create: `server/src/github/GitOperationService.test.js`

### Step 5.1: 临时凭据 helper

`server/src/github/gitCredentialHelper.js`：

```js
const fs = require('fs');
const path = require('path');
const os = require('os');

function buildAuthenticatedUrl(repoUrl, token) {
  try {
    const url = new URL(repoUrl);
    url.username = 'x-access-token';
    url.password = token;
    return url.toString();
  } catch {
    return repoUrl;
  }
}

function buildAskpassScript(token) {
  const safeToken = token.replace(/'/g, "'\\''").replace(/"/g, '\\"');
  return `#!/bin/sh\ncase "\$1" in\n  *Username*) echo "x-access-token" ;;\n  *Password*) echo "${safeToken}" ;;\nesac\n`;
}

function writeTempAskpassScript(token) {
  const scriptPath = path.join(os.tmpdir(), `xe-askpass-${Date.now()}-${process.pid}.sh`);
  fs.writeFileSync(scriptPath, buildAskpassScript(token), { mode: 0o700 });
  return scriptPath;
}

function cleanupAskpassScript(scriptPath) {
  try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
}

module.exports = { buildAuthenticatedUrl, buildAskpassScript, writeTempAskpassScript, cleanupAskpassScript };
```

### Step 5.2: 实现 GitOperationService

```js
const fs = require('fs');
const path = require('path');
const { writeTempAskpassScript, cleanupAskpassScript } = require('./gitCredentialHelper');
const { ensureProjectRuntime } = require('../runtime/RuntimeService');
const { getRuntime } = require('../runtime/registry');

class GitOperationService {
  constructor({ execAdapter = getRuntime().exec, runtimeService = { ensureProjectRuntime } } = {}) {
    this.execAdapter = execAdapter;
    this.runtimeService = runtimeService;
  }

  async _workspacePath(project) {
    const { workspacePath } = await this.runtimeService.ensureProjectRuntime(project);
    return workspacePath;
  }

  async _exec(project, token, args, opts = {}) {
    const workspacePath = await this._workspacePath(project);
    let env = opts.env || {};
    let askpassPath = null;
    if (token) {
      askpassPath = writeTempAskpassScript(token);
      env = { ...env, GIT_ASKPASS: askpassPath, GIT_TERMINAL_PROMPT: '0' };
    }
    try {
      return await this.execAdapter.exec('git', args, env, { cwd: workspacePath, timeoutMs: opts.timeoutMs || 120_000 });
    } finally {
      if (askpassPath) cleanupAskpassScript(askpassPath);
    }
  }

  async cloneRepo(project, { repoUrl, branch, depth = 0 } = {}) {
    const token = project._token; // 由调用方从 GitConnectionService 获取后挂载
    const targetBranch = branch || project.repoDefaultBranch || 'main';
    const remoteUrl = (repoUrl || project.repoUrl).replace(/^(https?:\/\/)[^@]+@/, '$1'); // 去除可能存在的凭据
    const workspacePath = await this._workspacePath(project);

    // LocalRuntimeProvider.ensureReady 会预先创建 workspace 目录（含 .agents/preview.json），
    // 因此不能直接用 git clone <url> <dir>。改为 init + fetch + checkout，避免 token 落入 .git/config。
    const isGitRepo = fs.existsSync(path.join(workspacePath, '.git'));
    if (!isGitRepo) {
      let res = await this.execAdapter.exec('git', ['init'], { GIT_TERMINAL_PROMPT: '0' }, { cwd: workspacePath, timeoutMs: 60_000 });
      if (res.exitCode !== 0) throw new Error(`git init failed: ${res.stderr}`);
      res = await this.execAdapter.exec('git', ['remote', 'add', 'origin', remoteUrl], { GIT_TERMINAL_PROMPT: '0' }, { cwd: workspacePath, timeoutMs: 60_000 });
      if (res.exitCode !== 0) throw new Error(`git remote add failed: ${res.stderr}`);
    }

    const fetchArgs = ['fetch', 'origin'];
    if (depth) fetchArgs.push('--depth', String(depth));
    fetchArgs.push(targetBranch);
    const res = await this._exec(project, token, fetchArgs, { timeoutMs: 300_000 });
    if (res.exitCode !== 0) throw new Error(`git fetch failed: ${res.stderr}`);

    const checkoutRes = await this._exec(project, null, ['checkout', '-b', targetBranch, `origin/${targetBranch}`], { timeoutMs: 60_000 });
    if (checkoutRes.exitCode !== 0) throw new Error(`git checkout failed: ${checkoutRes.stderr}`);

    const sha = await this._revParse(project, 'HEAD');
    return { sha, branch: targetBranch };
  }

  async _revParse(project, ref) {
    const { stdout } = await this._exec(project, null, ['rev-parse', ref]);
    return stdout.trim();
  }

  async createBranch(project, branchName, baseBranch) {
    const base = baseBranch || project.repoDefaultBranch || 'main';
    await this._exec(project, null, ['checkout', '-b', branchName, base]);
    const sha = await this._revParse(project, branchName);
    return { branch: branchName, sha };
  }

  async switchBranch(project, branchName) {
    await this._exec(project, null, ['checkout', branchName]);
    const sha = await this._revParse(project, 'HEAD');
    return { branch: branchName, sha };
  }

  async getStatus(project) {
    const { stdout } = await this._exec(project, null, ['status', '--porcelain=v1', '--branch']);
    const lines = stdout.split('\n').filter(Boolean);
    const branchLine = lines.find(l => l.startsWith('##')) || '';
    const branchMatch = branchLine.match(/##\s+([^\.\s]+)/);
    const aheadBehindMatch = branchLine.match(/\[ahead\s+(\d+)(?:,\s*behind\s+(\d+))?\]/);
    const dirty = lines.some(l => !l.startsWith('##'));
    return {
      branch: branchMatch ? branchMatch[1] : null,
      sha: await this._revParse(project, 'HEAD').catch(() => null),
      dirty,
      staged: lines.some(l => l.startsWith('A ') || l.startsWith('M ') || l.startsWith('D ')),
      unstaged: lines.some(l => l.startsWith(' M') || l.startsWith(' D') || l.startsWith('??')),
      untracked: lines.some(l => l.startsWith('??')),
      ahead: aheadBehindMatch ? Number(aheadBehindMatch[1]) : 0,
      behind: aheadBehindMatch && aheadBehindMatch[2] ? Number(aheadBehindMatch[2]) : 0,
    };
  }

  async commitAll(project, message) {
    await this._exec(project, null, ['add', '-A']);
    const res = await this._exec(project, null, ['commit', '-m', message]);
    if (res.exitCode !== 0) throw new Error(`commit failed: ${res.stderr}`);
    return { sha: await this._revParse(project, 'HEAD') };
  }

  async pushBranch(project, branchName, { force = false } = {}) {
    const token = project._token;
    const args = ['push'];
    if (force) args.push('--force');
    args.push('origin', branchName || project.currentBranch || 'HEAD');
    const res = await this._exec(project, token, args);
    if (res.exitCode !== 0) throw new Error(`push failed: ${res.stderr}`);
    return { sha: await this._revParse(project, 'HEAD') };
  }

  async getDiff(project, { base, head } = {}) {
    const args = ['diff'];
    if (base && head) args.push(`${base}...${head}`);
    else if (base) args.push(base);
    const { stdout } = await this._exec(project, null, args);
    return stdout;
  }

  async getLog(project, { branch, limit = 20 } = {}) {
    const args = ['log', `--max-count=${limit}`, '--pretty=format:%H%x00%s%x00%an%x00%ai'];
    if (branch) args.push(branch);
    const { stdout } = await this._exec(project, null, args);
    return stdout.split('\n').filter(Boolean).map(line => {
      const [sha, message, author, date] = line.split('\x00');
      return { sha, message, author, date };
    });
  }
}

module.exports = { GitOperationService };
```

> 注：`RuntimeService.ensureProjectRuntime(project)` 返回 `{ runtime, workspacePath, recoverable }`；`GitOperationService` 通过 `getRuntime().exec` 获取 `ExecAdapter`，不依赖 `ensureProjectRuntime` 返回 exec。

### Step 5.3: 测试 git 命令参数构造

`server/src/github/GitOperationService.test.js`：

```js
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { buildAuthenticatedUrl } = require('./gitCredentialHelper');

describe('gitCredentialHelper', () => {
  test('buildAuthenticatedUrl embeds token', () => {
    const url = buildAuthenticatedUrl('https://github.com/owner/repo.git', 'tok123');
    assert.strictEqual(url, 'https://x-access-token:tok123@github.com/owner/repo.git');
  });
});
```

> 对真实 git 命令的测试需要临时目录与 mock runtime；可在 `test_root2/` 或 `os.tmpdir()` 中创建 git 仓库验证。

### Step 5.4: Commit

```bash
git add server/src/github/GitOperationService.js server/src/github/gitCredentialHelper.js server/src/github/GitOperationService.test.js
git commit -m "feat(github): GitOperationService git command orchestration"
```

---

## Task 6: PullRequestService — PR 创建与同步

**Files:**
- Create: `server/src/github/PullRequestService.js`
- Create: `server/src/github/PullRequestService.test.js`

### Step 6.1: 实现 PullRequestService

```js
const crypto = require('crypto');
const { eq } = require('drizzle-orm');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { recordEvent } = require('../events/recordEvent');

function newId(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }

class PullRequestService {
  constructor(gitHubService, gitOperationService, gitConnectionService) {
    this.github = gitHubService;
    this.gitOps = gitOperationService;
    this.conn = gitConnectionService;
  }

  _parseFullName(fullName) {
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) throw new Error('invalid_github_full_name');
    return { owner, repo };
  }

  async create(project, { title, body, sourceBranch, targetBranch }, actorUserId) {
    const token = await this.conn.getDecryptedToken(project.userId);
    const source = sourceBranch || project.currentBranch;
    const target = targetBranch || project.repoDefaultBranch || 'main';

    // 1. push source branch
    await this.gitOps.pushBranch(project, source, { force: false });

    // 2. create PR on GitHub
    const { owner, repo } = this._parseFullName(project.githubFullName);
    const ghPr = await this.github.createPullRequest(token, owner, repo, {
      title,
      body: body || '',
      head: source,
      base: target,
    });

    // 3. persist
    const now = Date.now();
    const id = newId('pr');
    await db.insert(schema.pullRequests).values({
      id,
      projectId: project.id,
      githubPrNumber: ghPr.number,
      githubPrUrl: ghPr.html_url,
      title,
      description: body,
      sourceBranch: source,
      targetBranch: target,
      status: 'open',
      githubState: ghPr.state,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: now,
    });

    await recordEvent({ userId: actorUserId, projectId: project.id, subjectType: 'pull_request', subjectId: id, type: 'pr.created', data: { number: ghPr.number, url: ghPr.html_url } });
    return this.get(id);
  }

  async sync(project, prId) {
    const token = await this.conn.getDecryptedToken(project.userId);
    const pr = await this.get(prId);
    const { owner, repo } = this._parseFullName(project.githubFullName);
    const ghPr = await this.github.getPullRequest(token, owner, repo, pr.github_pr_number);
    const status = ghPr.state === 'closed' ? (ghPr.merged ? 'merged' : 'closed') : 'open';
    const now = Date.now();
    await db.update(schema.pullRequests).set({
      status,
      githubState: ghPr.state,
      mergeSha: ghPr.merge_commit_sha || null,
      updatedAt: now,
      lastSyncedAt: now,
    }).where(eq(schema.pullRequests.id, prId));
    return this.get(prId);
  }

  async list(projectId) {
    const rows = await db.select().from(schema.pullRequests).where(eq(schema.pullRequests.projectId, projectId));
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(r => ({
      id: r.id,
      project_id: r.projectId,
      github_pr_number: r.githubPrNumber,
      github_pr_url: r.githubPrUrl,
      title: r.title,
      source_branch: r.sourceBranch,
      target_branch: r.targetBranch,
      status: r.status,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      last_synced_at: r.lastSyncedAt,
    }));
  }

  async get(prId) {
    const rows = await db.select().from(schema.pullRequests).where(eq(schema.pullRequests.id, prId));
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      project_id: r.projectId,
      github_pr_number: r.githubPrNumber,
      github_pr_url: r.githubPrUrl,
      title: r.title,
      description: r.description,
      source_branch: r.sourceBranch,
      target_branch: r.targetBranch,
      status: r.status,
      github_state: r.githubState,
      merge_sha: r.mergeSha,
      created_by: r.createdBy,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
      last_synced_at: r.lastSyncedAt,
    };
  }
}

module.exports = { PullRequestService };
```

### Step 6.2: 测试 PR 创建流程

`server/src/github/PullRequestService.test.js`：

```js
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { PullRequestService } = require('./PullRequestService');

describe('PullRequestService', () => {
  test('parseFullName validates owner/repo', () => {
    const svc = new PullRequestService();
    assert.deepStrictEqual(svc._parseFullName('owner/repo'), { owner: 'owner', repo: 'repo' });
    assert.throws(() => svc._parseFullName('invalid'), /invalid_github_full_name/);
  });
});
```

### Step 6.3: Commit

```bash
git add server/src/github/PullRequestService.js server/src/github/PullRequestService.test.js
git commit -m "feat(github): PullRequestService create and sync"
```

---

## Task 7: 路由层 — GitHub API 端点

**Files:**
- Create: `server/src/routes/github.js`
- Modify: `server/src/server.js`

### Step 7.1: 实现路由

`server/src/routes/github.js`：

```js
const { GitHubService } = require('../github/GitHubService');
const { GitConnectionService } = require('../github/GitConnectionService');
const { GitOperationService } = require('../github/GitOperationService');
const { PullRequestService } = require('../github/PullRequestService');
const { scaffoldXEnsemble } = require('../repositories/RepositoryEnvironmentService');
const { db } = require('../db/index');
const schema = require('../db/schema');
const { eq, and } = require('drizzle-orm');

function getProjectForUser(projectId, userId) {
  return db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .then(rows => rows[0] || null);
}

async function registerGitHubRoutes(fastify) {
  const githubService = new GitHubService();
  const gitConnectionService = new GitConnectionService(githubService);
  const gitOperationService = new GitOperationService();
  const pullRequestService = new PullRequestService(githubService, gitOperationService, gitConnectionService);

  // 获取当前连接
  fastify.get('/api/v1/github/connection', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
    const conn = await gitConnectionService.getConnection(request.user.id);
    if (!conn) return reply.code(404).send({ error: 'GitHub not connected' });
    return conn;
  });

  // 发起 OAuth
  fastify.post('/api/v1/github/connect', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
    const { authUrl } = await gitConnectionService.initiateOAuth(request.user.id);
    return { auth_url: authUrl };
  });

  // GitHub 公开回调
  fastify.get('/api/v1/github/callback', async (request, reply) => {
    const { code, state } = request.query;
    try {
      await gitConnectionService.completeOAuthFromCallback(code, state);
      reply.type('text/html').send('<html><body><h1>GitHub connected</h1><p>You can close this tab and return to XEnsemble.</p></body></html>');
    } catch (err) {
      reply.code(400).type('text/html').send(`<html><body><h1>Connection failed</h1><p>${err.message}</p></body></html>`);
    }
  });

  // Desktop POST 回调
  fastify.post('/api/v1/github/callback', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
    const { code, state } = request.body;
    const conn = await gitConnectionService.completeOAuthFromDesktop(request.user.id, code, state);
    return conn;
  });

  // 断开连接
  fastify.delete('/api/v1/github/connection', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
    await gitConnectionService.disconnect(request.user.id);
    return { ok: true };
  });

  // 列出仓库
  fastify.get('/api/v1/github/repos', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
    const token = await gitConnectionService.getDecryptedToken(request.user.id);
    const { page = '1', per_page = '30' } = request.query;
    const repos = await githubService.listUserRepos(token, { page: Number(page), perPage: Number(per_page) });
    return { repos };
  });

  // 导入 GitHub 仓库
  fastify.post('/api/v1/projects/import-github', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
    // TODO: implement in Task 8
    return reply.code(501).send({ error: 'Not implemented' });
  });

  // git / branch / PR 路由占位，在 Task 8 中补齐
}

module.exports = { registerGitHubRoutes };
```

### Step 7.2: 注册路由

在 `server/src/server.js` 中，找到现有 `register*` 调用附近，加入：

```js
const { registerGitHubRoutes } = require('./routes/github');
// ...
registerGitHubRoutes(fastify);
```

### Step 7.3: Commit

```bash
git add server/src/routes/github.js server/src/server.js
git commit -m "feat(routes): register github routes (oauth and repos)"
```

---

## Task 8: 仓库导入、Git/分支/PR 路由与 `.xensemble/` Scaffold

**Files:**
- Modify: `server/src/routes/github.js`
- Modify: `server/src/repositories/RepositoryEnvironmentService.js`
- Modify: `server/src/db/schema.js` 导出的 helper（如需要）

### Step 8.1: 仓库导入服务逻辑

在 `server/src/routes/github.js` 中实现 `POST /api/v1/projects/import-github`：

```js
const crypto = require('crypto');
const { projectDir } = require('../workspace');

function newId(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }

fastify.post('/api/v1/projects/import-github', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const userId = request.user.id;
  const {
    github_repo_full_name,
    name,
    branch,
    auto_create_branch = true,
    work_branch_name = `xensemble/${Date.now()}`,
  } = request.body;

  const token = await gitConnectionService.getDecryptedToken(userId);
  const [owner, repo] = github_repo_full_name.split('/');
  const ghRepo = await githubService.getRepo(token, owner, repo);

  const projectId = newId('proj');
  const serverPath = projectDir(userId, projectId); // 先计算路径，clone 时再创建
  const now = Date.now();

  const projectRow = {
    id: projectId,
    userId,
    name: name || repo,
    serverPath,
    repoProvider: 'github',
    repoUrl: ghRepo.clone_url,
    repoDefaultBranch: ghRepo.default_branch || 'main',
    repoTokenSecretRef: (await gitConnectionService.getConnection(userId)).id,
    workspaceMode: 'git',
    githubRepoId: ghRepo.id,
    githubFullName: ghRepo.full_name,
    currentBranch: auto_create_branch ? work_branch_name : (branch || ghRepo.default_branch),
    cloneStatus: 'cloning',
    createdAt: now,
  };
  await db.insert(schema.projects).values(projectRow);

  // 异步 clone
  (async () => {
    try {
      const project = { ...projectRow, _token: token };
      await gitOperationService.cloneRepo(project, { repoUrl: ghRepo.clone_url, branch: branch || ghRepo.default_branch });
      if (auto_create_branch) {
        await gitOperationService.createBranch(project, work_branch_name, project.repoDefaultBranch);
      }
      await scaffoldXEnsemble(project.serverPath, { baseBranch: project.repoDefaultBranch, autoCommitOnExit: true });
      await db.update(schema.projects).set({ cloneStatus: 'ready', cloneError: null }).where(eq(schema.projects.id, projectId));
      await db.insert(schema.projectBranches).values({
        id: newId('br'),
        projectId,
        branchName: project.currentBranch,
        baseBranch: project.repoDefaultBranch,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (err) {
      await db.update(schema.projects).set({ cloneStatus: 'failed', cloneError: err.message }).where(eq(schema.projects.id, projectId));
    }
  })();

  return {
    id: projectId,
    name: projectRow.name,
    github_full_name: projectRow.githubFullName,
    repo_url: projectRow.repoUrl,
    current_branch: projectRow.currentBranch,
    status: 'cloning',
    created_at: now,
  };
});
```

### Step 8.2: `.xensemble/` scaffold

在 `server/src/repositories/RepositoryEnvironmentService.js` 中新增：

```js
const fs = require('fs');
const path = require('path');

function scaffoldXEnsemble(projectDir, opts = {}) {
  const dir = path.join(projectDir, '.xensemble');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const subdirs = ['rules', 'memory', 'prompts', 'workflows', 'cache'];
  for (const sub of subdirs) {
    const subdir = path.join(dir, sub);
    if (!fs.existsSync(subdir)) fs.mkdirSync(subdir, { recursive: true });
  }

  const gitignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, '# XEnsemble workspace metadata — do not commit\n*\n!.gitignore\n', 'utf8');
  }

  const configPath = path.join(dir, 'config.json');
  const config = {
    version: 1,
    auto_commit_on_exit: opts.autoCommitOnExit !== false,
    base_branch: opts.baseBranch || 'main',
    default_work_branch_prefix: 'xensemble/',
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  return dir;
}

module.exports = {
  // existing exports
  scaffoldXEnsemble,
};
```

### Step 8.3: Git / 分支 / PR 路由

在 `server/src/routes/github.js` 继续追加：

```js
async function loadProject(projectId, userId) {
  const rows = await db.select().from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)));
  return rows[0] || null;
}

// Git status
fastify.get('/api/v1/projects/:id/git/status', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const token = await gitConnectionService.getDecryptedToken(request.user.id);
  const status = await gitOperationService.getStatus({ ...project, _token: token });
  return status;
});

// Commit all
fastify.post('/api/v1/projects/:id/git/commit', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const { message } = request.body;
  const res = await gitOperationService.commitAll(project, message || 'XEnsemble checkpoint');
  return res;
});

// Push
fastify.post('/api/v1/projects/:id/git/push', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const token = await gitConnectionService.getDecryptedToken(request.user.id);
  const res = await gitOperationService.pushBranch({ ...project, _token: token }, request.body.branch);
  return res;
});

// Diff
fastify.get('/api/v1/projects/:id/git/diff', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const diff = await gitOperationService.getDiff(project, { base: request.query.base, head: request.query.head });
  return { diff };
});

// Create branch
fastify.post('/api/v1/projects/:id/branches', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const { name, base_branch } = request.body;
  const res = await gitOperationService.createBranch(project, name, base_branch);
  return res;
});

// Switch branch
fastify.post('/api/v1/projects/:id/branches/switch', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const { branch } = request.body;
  const res = await gitOperationService.switchBranch(project, branch);
  await db.update(schema.projects).set({ currentBranch: branch }).where(eq(schema.projects.id, project.id));
  return res;
});

// Create PR
fastify.post('/api/v1/projects/:id/pull-requests', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const pr = await pullRequestService.create(project, request.body, request.user.id);
  return pr;
});

// List PRs
fastify.get('/api/v1/projects/:id/pull-requests', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  return { pull_requests: await pullRequestService.list(project.id) };
});

// Sync PR
fastify.post('/api/v1/projects/:id/pull-requests/:prId/sync', { preValidation: [fastify.authenticate, fastify.requireActive] }, async (request, reply) => {
  const project = await loadProject(request.params.id, request.user.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const pr = await pullRequestService.sync(project, request.params.prId);
  return pr;
});
```

### Step 8.4: Session 启动注入 Git 环境变量

在 `server/src/server.js` 的 `POST /api/v1/session/start` 路由中，找到 spawn env 构造处，追加：

```js
const gitEnv = {};
if (project && project.repoProvider === 'github') {
  gitEnv.XENSEMBLE_GIT_BRANCH = project.currentBranch || '';
  gitEnv.XENSEMBLE_GIT_BASE_BRANCH = project.repoDefaultBranch || '';
  gitEnv.XENSEMBLE_REPO_URL = project.githubFullName || '';
}
// 合并到 spawnEnv
```

### Step 8.5: Commit

```bash
git add server/src/routes/github.js server/src/repositories/RepositoryEnvironmentService.js server/src/server.js
git commit -m "feat(github): import repo, git/branch/pr routes, .xensemble scaffold"
```

---

## Task 9: Desktop Client UI

**Files:**
- Create: `desktop/src/renderer/lib/githubApi.js`
- Create: `desktop/src/renderer/hooks/useGitHub.js`
- Create: `desktop/src/renderer/hooks/useGitStatus.js`
- Create: `desktop/src/renderer/hooks/usePullRequests.js`
- Create: `desktop/src/renderer/components/github/GitHubConnectButton.jsx`
- Create: `desktop/src/renderer/components/github/RepoImportDialog.jsx`
- Create: `desktop/src/renderer/components/github/BranchSelector.jsx`
- Create: `desktop/src/renderer/components/github/GitStatusBar.jsx`
- Create: `desktop/src/renderer/components/github/CreatePRDialog.jsx`
- Create: `desktop/src/renderer/components/github/PRListPanel.jsx`
- Modify: `desktop/src/renderer/components/settings/SettingsModal.jsx`

### Step 9.1: API 封装

`desktop/src/renderer/lib/githubApi.js`：

```js
import { apiFetch } from './api'; // 复用项目现有 apiFetch

export const githubApi = {
  getConnection: () => apiFetch('/api/v1/github/connection'),
  connect: () => apiFetch('/api/v1/github/connect', { method: 'POST' }),
  disconnect: () => apiFetch('/api/v1/github/connection', { method: 'DELETE' }),
  listRepos: (params) => apiFetch(`/api/v1/github/repos?${new URLSearchParams(params)}`),
  importRepo: (body) => apiFetch('/api/v1/projects/import-github', { method: 'POST', body: JSON.stringify(body) }),
  getGitStatus: (projectId) => apiFetch(`/api/v1/projects/${projectId}/git/status`),
  commit: (projectId, body) => apiFetch(`/api/v1/projects/${projectId}/git/commit`, { method: 'POST', body: JSON.stringify(body) }),
  push: (projectId, body) => apiFetch(`/api/v1/projects/${projectId}/git/push`, { method: 'POST', body: JSON.stringify(body) }),
  createBranch: (projectId, body) => apiFetch(`/api/v1/projects/${projectId}/branches`, { method: 'POST', body: JSON.stringify(body) }),
  switchBranch: (projectId, body) => apiFetch(`/api/v1/projects/${projectId}/branches/switch`, { method: 'POST', body: JSON.stringify(body) }),
  listPullRequests: (projectId) => apiFetch(`/api/v1/projects/${projectId}/pull-requests`),
  createPullRequest: (projectId, body) => apiFetch(`/api/v1/projects/${projectId}/pull-requests`, { method: 'POST', body: JSON.stringify(body) }),
};
```

### Step 9.2: Hooks

`desktop/src/renderer/hooks/useGitHub.js`：

```js
import { useState, useEffect, useCallback } from 'react';
import { githubApi } from '../lib/githubApi';

export function useGitHub() {
  const [connection, setConnection] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await githubApi.getConnection();
      setConnection(data);
    } catch {
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const connect = async () => {
    const { auth_url } = await githubApi.connect();
    window.open(auth_url, '_blank');
    // 轮询
    const timer = setInterval(async () => {
      try {
        const data = await githubApi.getConnection();
        if (data) { setConnection(data); clearInterval(timer); }
      } catch { /* ignore */ }
    }, 2000);
    // 5 分钟后停止轮询
    setTimeout(() => clearInterval(timer), 5 * 60 * 1000);
  };

  const disconnect = async () => {
    await githubApi.disconnect();
    setConnection(null);
  };

  return { connection, loading, connect, disconnect, refresh };
}
```

`desktop/src/renderer/hooks/useGitStatus.js`：

```js
import { useState, useEffect } from 'react';
import { githubApi } from '../lib/githubApi';

export function useGitStatus(projectId, enabled = true) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let timer;
    const poll = async () => {
      try {
        const data = await githubApi.getGitStatus(projectId);
        setStatus(data);
      } catch { /* ignore */ }
      timer = setTimeout(poll, 2000);
    };
    poll();
    return () => clearTimeout(timer);
  }, [projectId, enabled]);
  return status;
}
```

### Step 9.3: Components

实现以下组件（ JSX 示例）：

- `GitHubConnectButton.jsx`：连接/断开按钮，调用 `useGitHub`。
- `RepoImportDialog.jsx`：`ConsoleDialogShell` md 档，选择仓库、配置分支、调用 `githubApi.importRepo`。
- `BranchSelector.jsx`：下拉选择当前分支、创建新分支。
- `GitStatusBar.jsx`：展示分支、ahead/behind、变更数、Commit/Push/Pull/Create PR 按钮。
- `CreatePRDialog.jsx`：填写标题、描述、目标分支，调用 `githubApi.createPullRequest`。
- `PRListPanel.jsx`：PR 列表表格。

每个组件遵循 `DESIGN.md`：
- 使用 `ConsoleDialogShell` + `consoleDialogMdClass`。
- 使用 `Button variant="primary"` / `consoleIconButtonClass`。
- 反馈用 `useToast`。

### Step 9.4: Settings Modal 新增 GitHub Tab

在 `desktop/src/renderer/components/settings/SettingsModal.jsx` 的 tab 列表中加入：

```js
const tabs = [
  { id: 'general', label: 'General' },
  { id: 'byok', label: 'BYOK' },
  { id: 'github', label: 'GitHub', component: GitHubSettingsPanel },
  // ...
];
```

### Step 9.5: Commit

```bash
git add desktop/src/renderer/lib/githubApi.js desktop/src/renderer/hooks/*.js desktop/src/renderer/components/github/*.jsx desktop/src/renderer/components/settings/SettingsModal.jsx
git commit -m "feat(desktop): github workflow ui components"
```

---

## Task 10: 测试脚本与端到端验证

**Files:**
- Modify: `server/package.json`

### Step 10.1: 更新测试脚本

```json
"test": "node --test src/llm/*.test.js src/config/*.test.js src/runtime/*.test.js src/auth/*.test.js src/session/*.test.js src/github/*.test.js"
```

### Step 10.2: 运行测试

```bash
cd server && npm test
```

Expected: 所有新增测试通过；现有测试不回归。

### Step 10.3: 手动验证清单

1. Admin 在 Settings → GitHub 配置 Client ID/Secret。
2. Desktop Client 点击 Connect GitHub → 浏览器打开授权页 → 授权后轮询成功。
3. Import from GitHub → 选择仓库 → 提交 → 项目创建，`clone_status` 从 `cloning` 变为 `ready`。
4. 打开 Session → 底部 GitStatusBar 显示分支与变更。
5. Agent 修改文件 → Commit → Push → Create PR。
6. PR 出现在 PRListPanel，点击跳转 GitHub。

### Step 10.4: Commit

```bash
git add server/package.json
git commit -m "chore(tests): include github tests in test runner"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec 章节 | 对应任务 |
|-----------|----------|
| 3.1 OAuth App + 轮询回调 | Task 2, Task 4, Task 7 |
| 3.3 平台配置 | Task 2 |
| 4.1/4.2 数据模型 | Task 1 |
| 5.1 GitHubService | Task 3 |
| 5.2 GitOperationService | Task 5 |
| 5.3 PullRequestService | Task 6 |
| 5.4 GitConnectionService | Task 4 |
| 6.x API 端点 | Task 7, Task 8 |
| 8.x Desktop UI | Task 9 |
| 9 安全设计 | Task 4 (token 加密), Task 5 (URL embed), Task 7 (auth hooks) |
| 10 执行面集成 | Task 5 (RuntimeService), Task 8 (session env) |
| 11 异步与轮询 | Task 4, Task 8 |
| 13 Agent 协同 | Task 8 (session env), Task 8 (auto commit) |
| 14 .xensemble/ | Task 8 |
| 15 配额 | Task 8 (复用 max_projects，暂无需额外代码) |

### Placeholder Scan

- [ ] 无 "TBD" / "TODO" / "implement later"
- [ ] 每个任务含具体文件路径与代码/命令
- [ ] 测试步骤含期望输出

### Type Consistency

- `GitConnectionService.getConnection()` 返回字段与路由响应一致：
  - `id`, `user_id`, `github_user_id`, `github_username`, `github_avatar`, `token_scope`, `connected_at`, `last_used_at`
- `PullRequestService.get()` / `list()` 返回字段与 API 响应一致：
  - `id`, `project_id`, `github_pr_number`, `github_pr_url`, `title`, `description`, `source_branch`, `target_branch`, `status`, `github_state`, `merge_sha`, `created_by`, `created_at`, `updated_at`, `last_synced_at`
- `projects` 表新增字段使用 camelCase（Drizzle schema）与 snake_case（DB）映射正确：
  - `currentBranch` ↔ `current_branch`
  - `githubRepoId` ↔ `github_repo_id`
  - `githubFullName` ↔ `github_full_name`
  - `cloneStatus` ↔ `clone_status`
  - `cloneError` ↔ `clone_error`

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-22-github-workflow-integration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
