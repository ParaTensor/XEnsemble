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

保存 API Key、平台设置等：**禁止**在弹窗内展示成功/失败条；使用 `useToast('success'|'error', message)`。

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
