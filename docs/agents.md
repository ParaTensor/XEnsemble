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

## Admin 表格行内操作

Agents 管理页（`AgentsAdmin.jsx`）及同类 Admin 表格的行内操作**仅用图标**，对齐 Users 页（`UsersAdmin.jsx`）：

- 使用原生 `<button>`，**不加边框**（不用 `Button variant="secondary"` 等带边框样式）。
- 样式：`p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900`；语义色操作（如审批）可沿用 Users 页配色。
- 必须设 `title` 作无障碍提示；图标尺寸 `w-3.5 h-3.5`（lucide-react）。
- **禁止**使用文件类图标（如 `File`）；安装 `Download`、卸载 `Trash2`、检查并更新 `RefreshCw`、密钥 `KeyRound`、编辑 executable `Pencil`。

## 内置 LLM 网关（UniGateway）

控制面在启动时拉起 `gateway/` 下的 Rust 二进制 `xensemble-unigateway`（嵌入 [UniGateway](https://github.com/EeroEternal/unigateway) crates）。默认监听 `127.0.0.1:8741`，配置 `server/data/unigateway.toml`。

- 构建：`cd gateway && cargo build --release`（或 `npm run build:gateway --prefix server`）
- 每个 Agent 可在 Agents 页单独设为 **BYOK** 或 **Gateway**；Gateway 模式走本机 UniGateway，BYOK 由用户在 Settings → BYOK 填密钥
- 控制面根据 Gateway 监听地址自动写入 `LLM_ROUTER_URL` / `LLM_ROUTER_API_KEY`（供 Gateway 模式 Agent 合成 env）；Admin 无需单独配置 Router URL
- Admin：`GET /api/v1/admin/gateway/status`、`/gateway/modes` 等代理到网关 `/api/admin/*`
- 推理面：`POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/embeddings`（OpenAI / Anthropic 兼容）

在 `unigateway.toml` 中配置 `[[providers]]` + `[[bindings]]` 后，Agent 的 `*_BASE_URL` 指向 Router URL 即可走网关。

## Agent 生命周期（服务器）

实现 `server/src/agents/agentLifecycle.js`；Admin API：

| 操作 | 方法 | 路径 |
|------|------|------|
| 安装 | POST | `/api/v1/admin/agents/:id/install` |
| 卸载 | POST | `/api/v1/admin/agents/:id/uninstall` |
| 更新 | POST | `/api/v1/admin/agents/:id/update` |
| 检查更新 | GET | `/api/v1/admin/agents/:id/check-update` |

内置 8 个 Agent 各有官方 install/uninstall/update 命令；自定义 Agent 回退为 `npm install/uninstall/update -g <cmd>`。npm 类 Agent 检查更新时对比 registry 最新版。

## Agents 表格列

- **Status**、**Version**、**Path** 分列：Status 仅 Installed / Not installed 徽章；Version 为已安装 CLI 版本（`v…`），未安装为 `—`；Path 为服务器上 CLI 绝对路径。
- **Auth** / **Model** / **Ready** 列反映 BYOK 或 Gateway 配置与就绪状态；具体设置在 Actions → Configure 弹窗。
- **Executable** 可通过 Actions → Edit 自定义 command 与 arguments（空格分隔）。

## 弹窗交互

所有弹窗须支持 **Escape** 键关闭，行为与点击 Cancel / backdrop 一致。

- 标准壳层：使用 `ConsoleDialogShell`（`client/src/components/ConsoleDialog.jsx`），内置 `useConsoleDialogEscape`。
- Console 页内联确认/启动弹窗：使用 `ConsoleInlineDialog`（同上）。
- 弹窗内的 `SelectMenu` / `MultiSelectMenu` 下拉打开时，**Esc 优先关闭下拉**（capture + `stopImmediatePropagation`），再次按 Esc 才关闭弹窗。
- 视觉与尺寸规范见 [Designs.md](./Designs.md) § 弹窗。
