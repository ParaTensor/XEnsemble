# 本地 Git 版本跟踪方案

**Workspace 版本历史的唯一规范**（单人、单分支、无远端 Git 服务）。系统架构约束以 [Architecture.md](./Architecture.md) 为准；本文仅定义本地 Git 在 XEnsemble 中的职责、数据模型与 API 契约，不重复 Runtime / Preview 全局设计。

## 1. 目标

为每个 Project（Workspace）提供轻量版本跟踪，满足：

| 需求 | 本地 Git 如何满足 |
|------|-------------------|
| 记录处理过程中的中间步骤，尽量不丢 | 在关键节点自动 `git commit`，commit 与 `workspace_checkpoints` 一一关联 |
| 修改出问题时可回到上一版本 | 通过 checkpoint 恢复：对 workspace 执行 `git reset --hard <sha>` |
| 具备 push / pull / PR 的基本语义 | **MVP 仅本地**；`push`/`pull` 预留为可选远端绑定；单人场景用 **带说明的 commit + diff** 替代 PR |

**非目标（本阶段）**：Forgejo/Gitea/GitHub 集成、多分支协作、Merge Request 工作流、CI/CD Actions、跨用户权限。

## 2. 设计原则

- **单分支**：每个 workspace 仅维护 `main`，不创建 feature branch。
- **写操作在执行面**：所有 `git` 命令经 `Runtime.exec` 在 workspace 目录内执行，控制面不直接 `fs` 操作 workspace（对齐 Architecture §5.2）。
- **Git 是版本事实来源**：checkpoint 的 `git_sha` 指向可回滚的 commit；`storage_ref` / `diff_ref` 在本地 Git 模式下可为空（不另做目录快照，除非后续需要更细粒度恢复）。
- **commit 有语义**：每次自动 commit 携带 `session_id`、触发原因、可选步骤摘要，便于审计与 Console 展示。
- **幂等与并发**：同一 project 的 commit / restore 须单飞（复用 `singleflight`），避免并发 checkpoint 竞态。

## 3. 生命周期

### 3.1 创建 Project

```
POST /api/v1/projects
  → createProjectDirectory(userId, projectId)
  → git init（workspace 根目录）
  → 写入 .gitignore（见 §6）
  → git commit -m "chore: initialize workspace" --allow-empty   # 可选：空初始 commit
  → projects.repo_provider = 'local_git'
  → projects.workspace_mode = 'git'
```

已有 project 在首次访问 checkpoint API 时若检测到无 `.git`，执行惰性 `git init`（backfill 脚本同理）。

### 3.2 Agent Session 运行中

Agent 在终端内改文件；平台在以下时机**自动创建 checkpoint**（`POST` 内部调用，非用户手点）：

| 触发器 | `trigger` 字段 | 说明 |
|--------|----------------|------|
| Session 正常结束 | `session.end` | 用户关闭终端或 agent 退出 |
| 用户点击「保存检查点」 | `manual` | Console 按钮（Designs.md 后续补充 UI） |
| Preview 部署前 | `preview.before_deploy` | `DeploymentService.deploy` 调用前 |
| 定时 / 步数阈值（可选） | `auto.interval` / `auto.steps` | 第二阶段；防止长 session 无 commit |

每次 checkpoint 执行：

```
git add -A
git diff --cached --quiet → 若无变更则跳过 commit，仅更新 checkpoint 元数据指向 HEAD
git commit -m "<结构化 message>"
→ 写入 workspace_checkpoints（git_sha = HEAD）
→ recordEvent(workspace_checkpoint.ready)
```

### 3.3 回滚

```
POST /api/v1/projects/:projectId/checkpoints/:checkpointId/restore
  → 校验 checkpoint.git_sha 存在于该 workspace repo
  → git reset --hard <git_sha>
  → 可选：git clean -fd（清除未跟踪文件，默认开启，可请求体关闭）
  → recordEvent(workspace_checkpoint.restored)
```

回滚后**不删除**较新的 commit（仍在 reflog 中）；仅移动 `HEAD`。若需「回滚后再前进」，用户可从 checkpoint 列表再次 restore 到较新 sha。

### 3.4 删除 Project

沿用 `deleteProject`：删除 workspace 目录（含 `.git`）及 DB 中 `workspace_checkpoints` 记录。

## 4. Commit Message 格式

便于解析与 Console 展示，采用约定前缀 + JSON trailer：

```
checkpoint(session.end): agent finished

session_id: sess_abc123
trigger: session.end
agent_id: claude
steps: 42
summary: Fixed preview port binding
```

控制面提供 `formatCheckpointMessage(meta)` 生成；`summary` 来自 session 元数据或请求体，长度上限 500 字符。

## 5. 数据模型（沿用现有表）

### projects

| 字段 | 本地 Git 取值 |
|------|---------------|
| `repo_provider` | `'local_git'`（新增枚举值；与 `'none'`、`'generic_git'` 等并存） |
| `workspace_mode` | `'git'` |
| `repo_url` | `null`（预留远端） |
| `last_sync_sha` | 最近一次成功 checkpoint 的 `git_sha` |

### workspace_checkpoints（已有）

| 字段 | 本地 Git 用法 |
|------|---------------|
| `git_sha` | **必填**（ready 状态）；commit 完整 40 位 sha |
| `session_id` | 关联产生该 checkpoint 的 session |
| `storage_ref` | `null`（不做额外文件系统快照） |
| `diff_ref` | 可选；缓存 `git show --stat` 摘要路径或内联 JSON |
| `status` | `pending` → `ready` / `failed` |

`repo_snapshots` 表在纯本地 Git 模式下**不使用**（保留给未来「从远端 pull 基线」场景）。

## 6. `.gitignore` 模板

创建 project 时写入 workspace 根目录：

```gitignore
# XEnsemble runtime / secrets — never version
.env
.env.*
!.env.example

# Dependencies & build
node_modules/
dist/
build/
.next/
.turbo/
__pycache__/
*.pyc
.venv/
venv/

# IDE / OS
.DS_Store
.idea/
.vscode/

# Logs & local caches
*.log
.npm/
.cache/
```

平台 secrets 与 Vault 注入的环境变量**不得**写入 workspace 文件；若 agent 生成 `.env`，应已在 ignore 列表中。

## 7. API 契约

### 已有（语义增强）

| 方法 | 路径 | 变更 |
|------|------|------|
| `POST` | `/api/v1/projects/:projectId/checkpoints` | 除写 DB 外，**执行 git commit**；响应含 `git_sha` |
| `GET` | `/api/v1/projects/:projectId/checkpoints` | 不变；列表按 `created_at` 降序 |

### 新增

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/projects/:projectId/checkpoints/:checkpointId/restore` | 回滚到该 checkpoint 的 `git_sha` |
| `GET` | `/api/v1/projects/:projectId/checkpoints/:checkpointId/diff` | 相对上一 checkpoint 或 `git show` 的 patch/stat（Console diff 视图） |
| `GET` | `/api/v1/projects/:projectId/repository/log` | 返回最近 N 条 commit（`git log --oneline` 结构化） |

### 请求 / 响应示例

**创建 checkpoint**

```http
POST /api/v1/projects/proj_xxx/checkpoints
Content-Type: application/json

{
  "session_id": "sess_abc",
  "trigger": "manual",
  "summary": "Refactored API routes"
}
```

```json
{
  "id": "ckpt_...",
  "project_id": "proj_xxx",
  "session_id": "sess_abc",
  "git_sha": "a1b2c3d4e5f6...",
  "status": "ready",
  "created_at": 1710000000000
}
```

**恢复**

```http
POST /api/v1/projects/proj_xxx/checkpoints/ckpt_yyy/restore
Content-Type: application/json

{ "clean_untracked": true }
```

错误码：`404` checkpoint 不存在；`409` 无 `git_sha` 或 sha 不在 repo；`503` runtime 未就绪。

## 8. 实现映射

| 模块 | 职责 |
|------|------|
| `server/src/git/LocalGitService.js`（新） | `initRepo`、`commitCheckpoint`、`restoreCheckpoint`、`getLog`、`getDiff`；内部调 `ensureProjectRuntime` + `runtime.exec` |
| `server/src/repositories/RepositoryEnvironmentService.js` | `createCheckpoint` 委托 `LocalGitService.commitCheckpoint`；`restoreCheckpoint` 新导出 |
| `server/src/workspace.js` | `createProjectDirectory` 后调 `LocalGitService.initRepo`（或 lazy init） |
| `server/src/server.js` | 注册 restore / diff / log 路由；session 结束钩子调 checkpoint |
| `server/src/session/SessionManager.js` | session `close` 时触发 `trigger: session.end` checkpoint（best-effort，失败记 event） |
| `server/src/deployments/DeploymentService.js` | `deploy` 前 `trigger: preview.before_deploy` |

**红线**（与 Architecture §8 一致）：

- `LocalGitService` 仅通过 `runtime.exec` 执行 git，禁止在控制面 `fs.readFile` workspace 内 `.git` 以外的业务文件。
- 非 Local provider 上线后，`LocalGitService` 逻辑迁移为 provider 内 `GitAdapter` 接口；Local 为首个实现。

## 9. Git 命令参考（Local provider）

均在 `cwd = workspacePath` 下执行，`timeout` 建议 30s（restore 60s）：

```bash
# init
git init -b main
git config user.email "xensemble@local"
git config user.name "XEnsemble"

# commit checkpoint
git add -A
git diff --cached --quiet || git commit -m "<message>"

# restore
git reset --hard <sha>
git clean -fd    # 当 clean_untracked=true

# introspection
git rev-parse HEAD
git log -n 20 --format='%H %s %ct'
git show --stat <sha>
git diff <parent_sha> <sha>
```

## 10. push / pull / PR 的后续扩展（可选）

本方案不为 MVP 实现远端，但预留字段与语义：

| 能力 | 后续做法 |
|------|----------|
| **push** | `projects.repo_url` 指向 bare repo 或 Forgejo；`LocalGitService.push()` 在 checkpoint 后异步执行 |
| **pull** | 绑定远端后 `git pull --rebase`；与 `repo_snapshots` 对齐 |
| **PR** | 单人场景继续用 checkpoint diff 即可；若接 Forgejo，可由 API 从「最近两个 checkpoint 的 diff」创建 PR description |

## 11. 演进步骤

1. **LocalGitService + init on create**：project 创建即 `git init`；`repo_provider=local_git`。
2. **checkpoint commit**：`POST checkpoints` 执行真实 commit；回填历史 project。
3. **restore API**：回滚 + event 审计。
4. **Session / Preview 钩子**：自动 checkpoint。
5. **Console UI**（Designs.md）：checkpoint 列表、diff、一键恢复。
6. **可选**：interval 自动 commit、远端 push。

每步完成后更新本文与 [Architecture.md](./Architecture.md) §9 步骤 7 的「Git 集成」子项。

## 12. 与 Architecture.md 的关系

- 本地 Git 是 **Project Dev Environment** 在「无外部 Git provider」时的简化实现：Git 同时承担「可追踪版本」与「checkpoint 恢复点」。
- `workspace_checkpoints.git_sha` 可作为 `deployments.revision` 的 `gitSha` 来源（替代当前占位 `checkpoint:<timestamp>`）。
- 未来接入 Forgejo 时：`repo_provider` 改为 `forgejo`，本地 repo 变为 working copy，本方案中的 checkpoint / restore 语义保持不变。

---

*版本：v1 草案（2026-06）*  
*维护：本地 Git 行为变更须 PR + 更新本文。*
