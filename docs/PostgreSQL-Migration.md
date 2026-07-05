# PostgreSQL 迁移设计

> **状态**：设计稿（待实施 PR）  
> **对齐**：`docs/Architecture.md` Phase 2 §「支持 PostgreSQL」、`docs/DurableSessions-Followups.md` §8  
> **目标**：移除 `better-sqlite3` 与 `server/data/emdash.db`，服务端持久化统一为 PostgreSQL。

---

## 1. 背景与动机

### 1.1 现状

控制面数据库入口为 `server/src/db/index.js`：

- 启动时在 `server/data/emdash.db` 上执行大段 `CREATE TABLE IF NOT EXISTS` 与 `PRAGMA table_info` + `ALTER TABLE` 增量迁移（约 580 行）。
- Drizzle schema（`server/src/db/schema.js`）使用 `drizzle-orm/sqlite-core`（26 张 `sqliteTable`），与运行时 DDL 存在双轨维护。
- 部分模块绕过 Drizzle，直接 `sqlite.prepare`（`PlatformSettings.js`、`backfillRuntimes.js`、`db/index.js` 种子数据段）。
- 运维 CLI `server/scripts/manage-user.js` 注释与行为均假定 SQLite 文件库。

### 1.2 为何要迁

| 问题 | 说明 |
|------|------|
| 测试 flake（Follow-ups §8） | `npm test` 并行跑多个 `*.test.js`，共享同一 `emdash.db`，行级竞态导致偶发失败。 |
| 架构 Phase 2 | `Architecture.md` 已规划多控制面实例 + Shared Postgres；SQLite 无法支撑并发写与水平扩展。 |
| 迁移可维护性 | 内联 `PRAGMA`/ALTER 无版本化，新环境与老库行为不一致，难以 code review。 |
| 生产就绪 | 连接池、备份、复制、监控均依赖标准 RDBMS，而非单文件 DB。 |

### 1.3 非目标（本 PR 不做）

- Redis / NATS 会话桥外置（Architecture Phase 2 其他项）。
- 更换 ORM；继续使用 **Drizzle ORM**。
- 改动 Workspace 文件存储、Runtime Provider、Gateway 等非 DB 子系统。
- 为历史 `emdash.db` 提供全自动零停机热迁移工具（可提供可选一次性导入脚本，见 §7）。

---

## 2. 目标架构

```
┌─────────────────────────────────────────────────────────┐
│  server (Fastify)                                        │
│    require('./db/index')  →  drizzle(db) + schema        │
│    scripts/manage-user.js  →  同一 DATABASE_URL          │
└───────────────────────────┬─────────────────────────────┘
                            │ DATABASE_URL (postgres://…)
                            ▼
┌─────────────────────────────────────────────────────────┐
│  PostgreSQL 16+                                          │
│    schema: public（默认）                                 │
│    migrations: drizzle-kit 版本化 SQL                    │
└─────────────────────────────────────────────────────────┘
```

### 2.1 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是（生产/测试/本地 dev） | 标准 PostgreSQL 连接串，例：`postgres://xensemble:xensemble@127.0.0.1:5432/xensemble` |
| `DATABASE_POOL_MAX` | 否 | 连接池上限，默认 `10` |
| `DATABASE_SSL` | 否 | 托管库设为 `true` 时启用 TLS |

**移除**：对 `server/data/emdash.db` 的路径假设；`server/data/` 仍可用于 UniGateway TOML、transcript 文件等**非关系库**数据。

### 2.2 依赖变更

```json
// server/package.json — 示意
{
  "dependencies": {
    "drizzle-orm": "^0.45.2",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.x",
    "@testcontainers/postgresql": "^10.x"
  }
}
```

- 驱动推荐 **`postgres`**（postgres.js）：与 Drizzle 官方 `drizzle-orm/postgres-js` 配套，纯 JS、支持 async。
- **删除** `better-sqlite3`（含 native 编译与 CI 缓存负担）。

### 2.3 Drizzle 配置

新增 `server/drizzle.config.ts`（或 `.js`）：

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

npm scripts 建议：

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

---

## 3. Schema 迁移（sqlite-core → pg-core）

文件：`server/src/db/schema.js` — 全表从 `sqliteTable` 改为 `pgTable`，自 `drizzle-orm/pg-core` 导入。

### 3.1 类型对照

| SQLite（现） | PostgreSQL（目标） | 备注 |
|--------------|-------------------|------|
| `text` | `text` / `varchar` | 主键、外键 ID 保持 `text`（UUID/自定义 id 字符串） |
| `integer`（Unix ms 时间戳） | `bigint` 或 `timestamp with time zone` | **推荐一次性改为 `timestamptz`**，应用层用 `Date`；若求最小 diff 可暂保留 `bigint` |
| `integer`（0/1 布尔） | `boolean` | 如 `sessions.recoverable` |
| `INSERT OR IGNORE` | `INSERT … ON CONFLICT DO NOTHING` | 种子与 PlatformSettings |
| `sqlite.prepare` 裸 SQL | Drizzle `insert().onConflictDoNothing()` 或迁移 SQL | 消除模块内 `sqlite` 引用 |

### 3.2 表清单（26 张，与现 schema 一一对应）

`users`, `user_quotas`, `platform_settings`, `secrets`, `projects`, `sessions`, `session_streams`, `agents`, `user_preferences`, `user_agent_grants`, `runtimes`, `deployments`, `events`, `dev_environment_profiles`, `repo_snapshots`, `workspace_checkpoints`, `refresh_tokens`, `github_connections`, `github_oauth_states`, `project_branches`, `pull_requests`, `git_connections`, `git_oauth_states`, `merge_requests`, `agent_box_images`

### 3.3 初始 migration

1. 以当前 `schema.js` + `db/index.js` 内最终 DDL 为**唯一真相**，生成 **一条** baseline migration（`drizzle/0000_*.sql`）。
2. 将 `db/index.js` 中「数据回填」逻辑（GitHub→Git 连接复制、默认 quota、agent catalog 种子）拆到：
   - `server/src/db/seed.js`（幂等，启动或 `npm run db:seed` 调用），或
   - 独立 migration 后的 `seed` 脚本（推荐：**seed 不进 SQL**，便于改 agent 列表）。
3. 删除所有 `PRAGMA table_info` / 运行时 `ALTER TABLE` 代码。

### 3.4 索引与约束

保持与现 SQLite 等价的：

- `UNIQUE` / `uniqueIndex`（用户名、token hash、MR 复合键等）
- `FOREIGN KEY`（Drizzle `.references()`）
- 部分索引名在 PG 需合法标识符；drizzle-kit generate 会自动处理

---

## 4. `db/index.js` 重构

**目标形态**（约 50 行，无 DDL）：

```js
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const schema = require('./schema');

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required');
}

const client = postgres(url, {
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  ssl: process.env.DATABASE_SSL === 'true' ? 'require' : undefined,
});

const db = drizzle(client, { schema });

module.exports = { db, client, schema };
```

**启动顺序**（`server/src/server.js`）：

1. 加载 env（已有或新增 `dotenv` 仅 dev）
2. `await migrate(db)` 或 CLI 预跑 `npm run db:migrate`（CI/生产推荐 migrate 与进程启动分离；本地 dev 可在 `server.js` top-level await migrate）
3. `await seedIfNeeded()`（agent catalog、platform_settings 默认值）
4. 注册 Fastify 路由

**导出变更**：移除 `sqlite` 导出；所有 `const { db, sqlite }` 调用方改为仅 `db`，裸 SQL 改为 Drizzle API。

---

## 5. 需修改的源码清单

### 5.1 直接依赖 `sqlite` 的文件（必须改）

| 文件 | 改动要点 |
|------|----------|
| `server/src/db/index.js` | 重写为 PG 连接；DDL/seed 外移 |
| `server/src/db/schema.js` | pg-core 全表 |
| `server/src/db/backfillRuntimes.js` | Drizzle 查询/插入，或 merge 进 migration 后删除 |
| `server/src/admin/PlatformSettings.js` | 去掉 `sqlite.prepare`，用 `insert().onConflictDoNothing()` |
| `server/src/session/reconcileRunningSessions.js` | JSDoc 类型改为 postgres-js drizzle |

### 5.2 测试文件（12 个，见 Follow-ups §8）

统一改用 **`server/src/test/db.js`** 测试 harness（新建）：

```js
// 伪代码 — 每 worker 独立库
const dbName = `xensemble_test_${process.pid}_${workerId}`;
// CREATE DATABASE … ; migrate ; return { db, cleanup }
```

| 文件 |
|------|
| `server/src/session/resumeSession.test.js` |
| `server/src/session/idleHibernate.test.js` |
| `server/src/session/recoverRunningSessions.test.js` |
| `server/src/session/reconcileRunningSessions.test.js` |
| `server/src/session/terminalBridge.test.js` |
| `server/src/runtime/AgentBoxImageService.test.js` |
| `server/src/runtime/TranscriptStore.test.js` |
| `server/src/auth/refreshToken.test.js` |
| `server/src/github/GitConnectionService.test.js` |
| `server/src/github/PullRequestService.test.js` |
| `server/src/llm/proxyModels.test.js` |
| `server/src/llm/proxy.acceptance.test.js` |

**策略**（二选一，PR 内择一并写进 README）：

- **A（推荐）**：CI/本地测试用 `@testcontainers/postgresql` 起 ephemeral Postgres；每 test 文件 `before` 建库 + migrate，`after` drop。
- **B**：固定 `DATABASE_URL` 指向本地 PG，库名含 `pid` + 随机后缀；要求开发者/CI 预装 Postgres。

通过 harness 注入 `db`，**禁止**测试再 `require('../db/index')` 共享全局单例（或 `index.js` 在 `NODE_ENV=test` 时读 `TEST_DATABASE_URL`）。

### 5.3 文档

| 文件 | 更新 |
|------|------|
| `docs/UserManagement.md` | `emdash.db` → `DATABASE_URL` / docker compose |
| `docs/DurableSessions-Followups.md` | §8 标记 resolved 并链到本文 |
| `docs/Architecture.md` | Phase 2 第 4 项可标「进行中/已完成」（实施 PR 合并时） |
| `AGENTS.md` / 根 README | 本地启动需 Postgres |

### 5.4 运维与本地开发

- 新增仓库根或 `server/` 下 `docker-compose.postgres.yml`（Postgres 16 + 健康检查 + 默认库/用户）。
- `server/scripts/manage-user.js`：注释改为 PostgreSQL；行为不变（仍 `require db`）。
- `.env.example`：`DATABASE_URL=postgres://xensemble:xensemble@127.0.0.1:5432/xensemble`

---

## 6. CI 变更

1. GitHub Actions job 增加 Postgres service container，或 testcontainers。
2. `npm test` 前：`export DATABASE_URL=…` + `npm run db:migrate`。
3. 移除对 `server/data/emdash.db` 的缓存/artifact 假设。
4. 删除 `better-sqlite3` 后，Node 20 CI 无需再处理 native rebuild（除非其他依赖）。

---

## 7. 可选：从 SQLite 导入存量数据

面向已有本地 `server/data/emdash.db` 的开发者，**非生产必做**：

1. 新 PG 库跑完 baseline migration。
2. 提供 `server/scripts/migrate-sqlite-to-pg.js`（一次性）：
   - 只读打开 `emdash.db`（`better-sqlite3` 仅 devDependency 或脚本内 optional）
   - 按表顺序 INSERT（尊重 FK）
   - 布尔/时间戳字段做类型转换
3. 文档说明：空库安装可跳过；有用户数据时跑导入脚本。

---

## 8. 分阶段 PR 计划（建议）

单 PR 亦可，若需拆分便于 review：

| 阶段 | 内容 | 可合并条件 |
|------|------|------------|
| **P1 基础设施** | drizzle-kit、docker-compose、`DATABASE_URL`、`db/index.js` 连接层、baseline migration | 服务能连空 PG 启动 |
| **P2 Schema + 种子** | `schema.js` pg-core、seed.js、去掉 index.js DDL | migrate + seed 幂等 |
| **P3 裸 SQL 清理** | PlatformSettings、backfillRuntimes | grep 无 `sqlite.` |
| **P4 测试 harness** | test/db.js + 12 个测试改造 | `npm test` 并行 3 轮无 flake |
| **P5 文档 + 可选导入** | UserManagement、Follow-ups §8、sqlite→pg 脚本 | 文档与行为一致 |

---

## 9. 验收标准

- [ ] 仓库无 `better-sqlite3` 生产依赖；无运行时创建 `emdash.db`。
- [ ] `DATABASE_URL` 未设置时，进程 fail-fast 并给出明确错误。
- [ ] `npm run db:migrate` 在空库上可重复执行（幂等）。
- [ ] `npm test` 连续运行 3 次，无 §8 类偶发失败。
- [ ] `npm run manage-user -- list` 在 PG 上正常工作。
- [ ] 现有 API 行为不变（用户/会话/项目/Git/Admin 冒烟）。
- [ ] `docs/UserManagement.md` 与本地 dev 说明不再引用 SQLite 文件路径。

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 本地 dev 需装 Postgres | docker-compose 一键起；文档写清 |
| 时间戳类型变更 | 首版可保留 bigint ms，后续 PR 再统一 timestamptz |
| 测试变慢（testcontainers） | 单 job 复用 container；或 schema template + `CREATE DATABASE … TEMPLATE` |
| 遗漏裸 SQL | PR 前 `rg 'sqlite\\.|better-sqlite3|emdash\\.db' server/` 为零 |

---

## 11. 参考

- Drizzle PostgreSQL：https://orm.drizzle.team/docs/get-started-postgresql
- Drizzle Kit migrations：https://orm.drizzle.team/docs/kit-overview
- `docs/Architecture.md` §9、§12 Phase 2
- `docs/DurableSessions-Followups.md` §8
