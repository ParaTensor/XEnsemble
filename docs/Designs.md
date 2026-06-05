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
| 弹窗壳 | `ConsoleDialog`（backdrop `bg-black/50`，无 blur） |
| 下拉 | `SelectMenu`（样式同 console input） |
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

## Settings 弹窗

- 尺寸：**600×400px** 固定（小屏 `max-w` / `max-h` 收缩）。
- 左侧 Tab：**128px**（`w-32`），`bg-zinc-50` + `border-r` 与右侧白底内容区分；选中项 `bg-black text-white`。
- General：仅 Router Base URL，无外框标题。
- Agents：上拉下表（Agent `SelectMenu` + API Key 表单）。

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
