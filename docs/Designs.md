# XEnsemble UI Design

**唯一 UI 规范**（对齐 [ParaRouter DESIGN.md](https://github.com/EeroEternal/ParaRouter/blob/main/DESIGN.md) 的 Console 面）。后端系统架构以 `docs/Architecture.md` 为唯一规范；`docs/agents.md` 与 `AGENTS.md` 仅引用本文，不重复细则。

## Surface：Console

Agent 控制台、Settings 弹窗、Registry 等 authenticated 页面均属 Console。

- **主色**：黑 / zinc（`bg-black`、`bg-zinc-900`），不用紫色营销色。
- **密度**：页面 `space-y-6`；标题 `text-2xl font-bold text-zinc-900`。
- **圆角**：控件 `rounded-md`；卡片/表格/弹窗 `rounded-lg`。
- **壳层**：`max-w-[1600px]` + `px-4 sm:px-6 lg:px-8`，主区 `py-8`（见 `appShellLayout.js`）。

## 实现对照（ParaRouter → XEnsemble）

| 能力 | 文件 |
|------|------|
| Token | `client/src/lib/consoleTokens.js` |
| 按钮 | `Button`、`buttonStyles.js` |
| 输入 | `Input` |
| 页头 | `PageHeader` |
| 弹窗壳 | `ConsoleDialog` + `consoleDialogSmClass` / `Md` / `Lg`（backdrop `bg-black/50`，无 blur） |
| Settings | `SettingsModal` + `SettingsShell` + 各 `*SettingsPanel` |
| 下拉 | `SelectMenu`（样式同 console input） |
| 多选下拉 | `MultiSelectMenu`（勾选列表，样式同 `SelectMenu`） |
| Toast | `Toast` / `useToast`（视觉同 ParaRouter `ActionToast`：顶部居中、图标） |

## Toast

操作反馈与提示信息（成功、失败、警告）**统一**使用 `useToast('success'|'error', message)`：顶部居中弹出、带图标、约 4s 自动消失（实现见 `Toast.jsx`，视觉对齐 ParaRouter `ActionToast`）。

- **必须 toast**：API 操作结果、部署/保存失败、Preview 失败详情等一切需用户注意的反馈文案。
- **禁止内联提示条**：不得在页面区域、弹窗内、面板内用红/绿 banner 或 `text-red-*` 条展示上述反馈（Settings、Preview、表单提交等一律 toast）。
- **可与 UI 状态并存**：如 Preview `FAILED` 徽章可保留作持久状态指示，但**错误详情**仍走 toast，不在终端区重复展示文案。

## 表单

- 用户可见标签：人类可读（如 **Router Base URL**），**不展示** `LLM_ROUTER_URL` 等 env 名。
- 分区标签：`text-xs font-semibold uppercase tracking-wider text-zinc-500`。
- 密钥输入：`Input` + `font-mono`。

## 多选下拉（MultiSelectMenu）

组件 `MultiSelectMenu`；触发器样式同 `SelectMenu` / console input。下拉列表 `createPortal` 至 `document.body`，层级 `consoleMenuDropdownZClass`（`z-[110]`，高于弹窗 `z-[101]`）。

### 全选控件

- 启用 `showSelectAll` 且传入 `label` 时，**标签行**为 `flex justify-between`：左侧字段标签，右侧 **checkbox + `Select all` 文案**（`text-xs text-zinc-600`）。
- 勾选「Select all」：值为全部选项 ID，**下拉触发器置灰禁用**（`bg-zinc-100 text-zinc-400`），触发器内仍显示 `placeholder`，**不**展示 `All agents` 等汇总文案。
- 取消勾选：清空选择，下拉恢复可用，用户逐项勾选 Agent。

### 选项列表

- 仅展示各可选项，独立勾选/取消，样式与 `SelectMenu` 选项一致。

### 触发器摘要

| 状态 | 展示 |
|------|------|
| Select all 已勾选 | `placeholder`（置灰） |
| 未选 | `placeholder` |
| 部分/自定义选中 | 最多 2 项标签 + `+k` |

### 新建 vs 编辑默认值

授予类多选（Agent access 等）在 **创建** 场景默认 **全选当前可用项**，减少管理员逐步勾选；**编辑** 场景保留已存授权，不自动改写。

实现：`UsersAdmin` 打开 Create 时 `agent_ids` 初始化为全部 Agent ID；Agent 列表晚于弹窗到达时补填一次（用户已手动改动则不覆盖）。

## 弹窗（ConsoleDialog）

所有 Console 弹窗统一 `ConsoleDialogBackdrop` + `ConsoleDialogPanel`（或等价样式）。**禁止**让弹窗撑满页面壳层宽度。

### 尺寸档位

| 档位 | 宽度 | 用途 | Token |
|------|------|------|-------|
| sm | `max-w-sm`（384px） | 确认、简短单步操作（删除、Launch session） | `consoleDialogSmClass` |
| md | `w-[480px]` | 标准表单（Settings、用户创建/编辑、Agent 配置） | `consoleDialogMdClass` |
| lg | `w-[560px]` | 字段多、含分区卡片的长表单（仅 md 不够时） | `consoleDialogLgClass` |

- **基类** `consoleDialogPanelClass` 不含 `w-full`；宽度由档位 token 或调用方 `className` 指定。
- **响应式**：各档位均加 `max-w-[calc(100vw-2rem)]`；内容可滚动时加 `max-h-[calc(100vh-2rem)] overflow-y-auto`。
- **外层容器**：`fixed inset-0 z-[100+] flex items-center justify-center p-4 pointer-events-none`；面板 `pointer-events-auto`。
- **禁止**：无 `max-width` 的 `w-full`、继承页面 `max-w-[1600px]` 壳层宽度、弹窗内表单字段随容器无限拉伸（多列 grid 用 `sm:grid-cols-2` 等约束列数，数字类短字段勿单行四列撑满宽屏）。

### 内边距

- md / lg 表单弹窗：`p-6`；标题 `font-bold text-lg text-zinc-900 mb-4`。
- sm 确认类：沿用 Console 内联弹窗 `p-4` / `p-5` 分区（可逐步迁移至 `ConsoleDialog`）。

## Settings 弹窗

**唯一 Settings 入口**：顶栏 `UserMenu`（账户头像）→ **Settings**，打开 `SettingsModal`。**禁止**独立 Settings 页面或顶栏 Settings 链接；历史路由 `/settings`、`/admin/platform` 重定向至 `/console`。

### 壳层

- 组件：`SettingsModal`（`ConsoleDialogBackdrop` + `ConsoleDialogPanel`）+ `SettingsShell`（左侧 Tab + 右侧面板）。
- 档位：**600px** 宽（`w-[600px]` + `consoleDialogPanelClass`），高度 **480px** 固定（`h-[480px]`，小屏 `max-h-[calc(100vh-2rem)]` 收缩）。
- 标题栏：左上 **Settings** + 右上关闭（`X`）；`Escape` / 点击 backdrop 关闭。
- 内层：`SettingsShell` 占满标题栏下方区域，`rounded-lg border` 分隔 Tab 与内容。

### 左侧 Tab

- 宽 **128px**（`w-32`），`bg-zinc-50` + `border-r`；选中 `consoleSettingsTabActiveClass`（`bg-black text-white`），未选 `consoleSettingsTabIdleClass`。
- 所有已登录用户：**General** · **Agents** · **Quota**。
- `role === 'admin'` 额外 **Platform**（平台策略，非普通用户可见）。

### 右侧面板

| Tab | 组件 | 内容 |
|-----|------|------|
| General | `GeneralSettingsPanel` | Router Base URL 等密钥；`SecretFields` + Save |
| Agents | `AgentSettingsPanel` | Agent `SelectMenu` + 各 Agent API Key 表单 + Save |
| Quota | `QuotaSettingsPanel` | 只读用量条（Projects / Sessions / Previews X/Y）+ resource tier；非 admin 且无 Agent 授权时琥珀提示条 |
| Platform | `PlatformSettingsPanel` | 仅 admin：注册模式、默认用户配额（`grid-cols-2`）、Session TTL + Save |

- 右区 `flex-1 overflow-y-auto bg-white p-3`；含 Save 的 Tab 表单用 `h-full flex flex-col`，字段区滚动、按钮 `justify-end` 贴底。
- 保存成功/失败一律 `useToast`；**禁止**面板内联 banner。

## Agent Registry（Admin）

实现 `AgentsAdmin.jsx`（路由 `/admin/agents` 或顶栏 Registry）。

- 布局：`PageHeader` + 表格；**禁止**在页面内平铺新增/编辑表单卡片。
- 新增：页头 **Add Agent** 打开 `ConsoleDialog`（**md** 档）；字段 `grid-cols-2`（ID、Display name、Command、Arguments JSON、Required env JSON）。
- 反馈一律 `useToast`。

## 用户管理（Admin）

规范见 `docs/UserManagement.md`；实现 `UsersAdmin.jsx`；平台配置见上文 Settings → Platform。

### `/admin/users`

- 布局同 Agent Registry：`PageHeader` + 表格 + `ConsoleDialog` 弹窗；**禁止**页面内平铺表单。
- 表格：用户名、状态徽章（active/pending/suspended）、用量 P/S/V、配额 tier、授权 Agent 数、最后登录。
- 弹窗（**md** 档）：用户名、密码（新建）、角色、状态、配额 `grid-cols-2`（非四列撑满）、Agent `MultiSelectMenu`（非 admin，`showSelectAll`，创建默认全选）、可选重置密码。
- 行内：编辑、审批（pending）、暂停/恢复。
- 反馈一律 `useToast`。

### Console（普通用户）

- Agent 下拉仅显示 `GET /agents` 授权列表；`agents.length === 0` 时禁用 Launch。
- Session 启动 `agent_not_granted` / `quota_exceeded` 错误在 Launch 弹窗内展示（非 toast）。

### 顶栏导航（admin）

**Users** · **Registry**，与 `UserMenu` 并列；平台配置在 `UserMenu` → Settings → Platform，**不出现在顶栏**。

## 配色

- 背景：壳 `bg-zinc-50`，内容 `bg-white`
- 边框：`border-zinc-200` / `border-zinc-300`
- 主按钮：`Button variant="primary"`
- 输入 focus：`focus:border-black focus:ring-1 focus:ring-black`

## Preview（Console 终端区）

数据与 API 契约见 `docs/Architecture.md` 5.3；实现组件 `PreviewPanel.jsx`。

### Preview 启动契约（`.agents/preview.json`）

**首选**：项目根 `.agents/preview.json`，每个 Workspace 独立一份；Deploy 时优先读取，覆盖同目录 `package.json` scripts。

新建 Workspace 时自动 scaffold 默认契约 + 占位 `index.html`（已有文件不覆盖）。示例见 `docs/examples/.agents/preview.json`。

| 字段 | 必填 | 说明 |
|------|------|------|
| `command` | 是 | 可执行命令（如 `npm`、`npx`、`python3`） |
| `args` | 否 | 参数数组；可用 `$PORT` 引用平台注入的监听端口 |
| `port` | 否 | 文档/默认端口，默认 `5173`；Local 实际端口由 runtime 分配并通过 `PORT` 环境变量注入 |

Node 项目常见写法：`{ "command": "npm", "args": ["run", "dev"], "port": 5173 }`（需 `package.json` 含 `dev` script）。

**Fallback**：无有效 `preview.json` 时，回退 `package.json` 的 `dev` / `start` / `preview` script。

### Console UI

- **位置**：有活跃 session 且绑定 workspace 时，控件在终端工具栏右侧（与 Disconnect / Workspace 图标同组）；Embed iframe 在工具栏下方、终端内容上方。
- **状态徽章**：`pending` / `building` / `amber`、`running` / `green`、`failed` / `red`，字号 `text-[10px] uppercase`。
- **操作**：Deploy preview（`POST /api/v1/projects/:id/preview`）、Stop、Restart、Open（新标签）、Embed（iframe，`h-48`，`sandbox` 含 scripts/forms）；图标按钮样式与工具栏其他操作一致。
- **TTL**：running 时显示 `expires_at` 倒计时（`font-mono text-[10px]`）。
- **错误**：遵 Toast 节；部署/操作失败与 `last_error_message` 用 `useToast('error', …)`，不在终端区内联展示。
- **鉴权 iframe**：`public_url` 追加 `access_token` query（Gateway 校验，见 Architecture 7）。
