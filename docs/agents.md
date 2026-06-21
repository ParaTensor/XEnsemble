# Agents

Agent 注册、`env_required`、Vault 注入与启动逻辑见 `server/src/db/index.js`、`server/src/server.js`（实现正按架构演进）。

**所有 UI / 交互规范以根目录 [DESIGN.md](../DESIGN.md) 为入口，细则见 [Designs.md](./Designs.md)**（与 ParaRouter 中 `AGENTS.md` → `DESIGN.md` 的关系相同；本文不重复 Designs 内容）。

**系统架构对齐**（强制）：所有涉及 Agent 启动、Runtime 选择、Executor、Workspace 文件操作、Session 生命周期、Preview/Deployment 服务的代码实现与重构，**必须严格遵循 [Architecture.md](./Architecture.md)**。 

- 本地开发默认使用 Local provider（完全模拟云端路径）。
- 任何直接使用 `node-pty`、本地 `fs.*` 操作 workspace 目录、假设 PTY 为本地进程的代码，**仅允许出现在 Local* 实现内部**，并必须有明确注释说明“仅 Local 有效”。
- 控制面（API、SessionManager 桥接、Auth、DB）与执行面（RuntimeExecutor / FsAdapter）必须解耦；新增能力优先扩展 interface。
- Preview 与 Deployment 是独立一等资源（与 agent shell session 解耦），用于云端部署后“看效果”的公网/租户 URL 访问。
- 架构变更或新 provider 引入后，需同步更新 Architecture.md。

本文与 Architecture.md、Designs.md 共同作为开发对齐依据。实现或评审前须阅读对应文档。

## 部署流程（强制）

**严禁直接在服务器上修改源码。** 所有代码变更必须通过 GitHub 工作流进入生产环境：

1. **本地开发与测试**  
   在本地完成代码修改，运行相关测试/构建：
   ```bash
   cd server && npm test
   cd client && npm run build
   cd desktop && npm run build
   cd gateway && cargo build --release
   ```

2. **提交并推送**  
   使用清晰、原子化的 commit message：
   ```bash
   git add <files>
   git commit -m "feat(scope): description"
   git push origin <branch>
   ```

3. **服务器更新**  
   登录服务器后执行仓库内的部署脚本：
   ```bash
   cd /home/xinference/github/XEnsemble
   ./deploy/update.sh
   ```
   该脚本会执行 `git pull`、安装依赖、构建 UniGateway / web admin，并重启 `xensemble` 服务。

4. **环境配置**  
   `deploy/xensemble.env` 是服务器本地配置文件（不在 Git 中追踪）。如需调整 `CONTROL_PLANE_PUBLIC_URL`、`ALLOWED_ORIGINS` 等运行时参数，应在本地修改并记录变更说明，随后通过服务器上的 `deploy/xensemble.env` 应用，最后重启服务。禁止在 `/etc/systemd/system/xensemble.service` 或源码目录中直接覆盖文件。

5. **回滚**  
   若部署后异常，使用 `git` 回退到上一个可用 commit，然后重新执行 `./deploy/update.sh`。

> 例外：服务器日志排查、临时 `curl` 验证、数据库只读查询允许；但任何对 `server/src/`、`client/src/`、`desktop/src/`、`gateway/src/` 或 `client/dist/` 的手动写入都属于禁止行为。

## Admin 表格行内操作

Agents 管理页（`AgentsAdmin.jsx`）及同类 Admin 表格的行内操作**仅用图标**，对齐 Users 页（`UsersAdmin.jsx`）：

- 使用原生 `<button>`，**不加边框**（不用 `Button variant="secondary"` 等带边框样式）。
- 样式：`p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900`；语义色操作（如审批）可沿用 Users 页配色。
- 必须设 `title` 作无障碍提示；图标尺寸 `w-3.5 h-3.5`（lucide-react）。
- **禁止**使用文件类图标（如 `File`）；安装 `Download`、卸载 `Trash2`、检查并更新 `RefreshCw`、密钥 `KeyRound`、编辑 executable `Pencil`。

## 表格单元格信息密度

- 若一个单元格需要展示两项相关但独立的信息（如 Auth 模式 + Ready 状态，或 Name + ID），**合并成一行并用括号括起次要信息**，例如：
  - `Gateway (Ready)` / `Gateway (Needs model)` / `BYOK (User keys)`
  - `Kimi Code (kimi-code)`
- 不要为了增加列数而把同一组状态拆成两行或多列。

## 表单布局规范

- **表单项必须垂直堆叠**：每个字段独占一行，整体放在一列内。
- 禁止在同一行并排放置两个输入/选择框（如 `grid-cols-2` 表单布局）。
- 如果字段很多，使用单列滚动；必要时通过分组卡片分隔，而不是多列并排。
- 详情弹窗中的关键状态卡片同样遵循“一列、多行”原则，不要把两个状态并排放在同一行。

## 内置 LLM 网关（UniGateway）

控制面在启动时拉起 `gateway/` 下的 Rust 二进制 `xensemble-unigateway`（嵌入 [UniGateway](https://github.com/EeroEternal/unigateway) crates）。默认监听 `127.0.0.1:8741`（仅内网），配置 `server/data/unigateway.toml`。

**Agent 连接方式**（Gateway 模式）见 **[LlmProxy.md](./LlmProxy.md)**：Agent 访问控制面 `/api/v1/llm/*`，由控制面反代至 UniGateway；spawn 时注入会话 token（`xel_*`），不注入平台 master key。

- 构建：`cd gateway && cargo build --release`（或 `npm run build:gateway --prefix server`）
- 每个 Agent 可在 Agents 页单独设为 **BYOK** 或 **Gateway**；Gateway 模式走控制面 LLM 反代，BYOK 由用户在 Settings → BYOK 填密钥
- 环境变量 **`CONTROL_PLANE_PUBLIC_URL`** 或 Settings → Gateway → Control plane public URL
- 外部 UniGateway：**`LLM_GATEWAY_UPSTREAM_URL`** 或 Settings → External UniGateway URL（Phase 3）
- 验收：`npm test --prefix server`；`npm run test:llm-acceptance --prefix server`
- Admin：`GET /api/v1/admin/gateway/status`、`/gateway/modes` 等代理到网关 `/api/admin/*`
- 推理面（对外）：`POST /api/v1/llm/v1/chat/completions` 等；对内 UniGateway：`POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/embeddings`

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
