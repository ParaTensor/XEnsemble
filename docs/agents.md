# Agents

Agent 注册、`env_required`、Vault 注入与启动逻辑见 `server/src/db/index.js`、`server/src/server.js`（实现正按架构演进）。

**所有 UI / 交互规范以 [Designs.md](./Designs.md) 为准**（与 ParaRouter 中 `AGENTS.md` → `DESIGN.md` 的关系相同；本文不重复 Designs 内容）。

**系统架构对齐**（强制）：所有涉及 Agent 启动、Runtime 选择、Executor、Workspace 文件操作、Session 生命周期、Preview/Deployment 服务的代码实现与重构，**必须严格遵循 [Architecture.md](./Architecture.md)**。 

- 本地开发默认使用 Local provider（完全模拟云端路径）。
- 任何直接使用 `node-pty`、本地 `fs.*` 操作 workspace 目录、假设 PTY 为本地进程的代码，**仅允许出现在 Local* 实现内部**，并必须有明确注释说明“仅 Local 有效”。
- 控制面（API、SessionManager 桥接、Auth、DB）与执行面（RuntimeExecutor / FsAdapter）必须解耦；新增能力优先扩展 interface。
- Preview 与 Deployment 是独立一等资源（与 agent shell session 解耦），用于云端部署后“看效果”的公网/租户 URL 访问。
- 架构变更或新 provider 引入后，需同步更新 Architecture.md。

本文与 Architecture.md、Designs.md 共同作为开发对齐依据。实现或评审前须阅读对应文档。
