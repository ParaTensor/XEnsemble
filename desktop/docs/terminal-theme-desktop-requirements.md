# Terminal Theme — XEnsemble Desktop 需求文档

> 关联文档：[terminal-theme-server-requirements.md](./terminal-theme-server-requirements.md)  
> 配色参考：[terminalcolors.com](https://terminalcolors.com/)

## 1. 背景

终端区域由两层组成：

| 层 | 负责方 | 用户感知 |
|---|---|---|
| **xterm 渲染** | Desktop（xterm.js） | 背景、ANSI 16/256 色、scrollback、选区等 |
| **Agent TUI** | 远端 PTY 内 CLI（如 Cursor Agent） | 输入条、状态栏等自绘 UI |

用户切换 theme 的核心体验是 **即时看到终端变色**（Nord → Dracula 等）。若必须 stop/start session 才生效，产品价值会大打折扣。

当前 Desktop 在 `consoleTheme.js` 写死 Nord preset；Settings 无入口；改 theme 无法热更新。

## 2. 目标

1. 用户在 **Settings** 中选择 terminal theme（首批来自 terminalcolors.com 的 dark preset）。
2. **Runtime 热切换**：保存后立即作用于所有已挂载的 `AgentConsole`（含 off-route 仍存活的 session），无需重开 session。
3. Theme preset 含完整 xterm `ITheme`（含暗色主题的 256 色灰阶 remap）。
4. 与 Server 联调时：session start 携带 `terminal_theme_id`，保证 **新 session** 的 Agent spawn env 与 theme 的 dark/light 一致。
5. Server 未就绪时：仅 localStorage + 本地 catalog 仍可独立工作（热切换 xterm 层）。

## 3. 非目标

- 不在 Desktop 改写 Agent 输出的 ANSI 流（不做 WebSocket 中间层染色）。
- 不实现 light preset 与 dark preset 切换时的 Agent 输入条完美同步（见 §6 限制）。
- 不修改 Morandi 浅色 Admin / Sidebar 设计 token（仅终端容器区域）。

## 4. Theme Preset 结构

新增 `src/renderer/lib/terminalThemes.js`：

```js
{
  id: 'nord',                    // 稳定 ID，与 Server catalog 一致
  label: 'Nord',
  appearance: 'dark',            // 'dark' | 'light'
  spawnEnv: { COLORFGBG: '15;0' }, // 供 session/start；Desktop 可读 Server 返回值
  xterm: {
    background: '#2E3440',
    foreground: '#D8DEE9',
    cursor: '#88C0D0',
    // … 完整 ITheme + extendedAnsi（暗色需 remap 232–255 灰阶）
  },
}
```

**首批 preset（MVP）**：`nord`、`dracula`、`tokyo-night`（或 `one-dark`）。

**默认**：`nord`。

工具函数：

- `listTerminalThemes()`
- `getTerminalTheme(id)`
- `getDefaultTerminalThemeId()`

## 5. 用户偏好

新增 `src/renderer/lib/terminalPrefs.js`：

- `loadTerminalThemeId()` / `saveTerminalThemeId(id)` — localStorage key：`xensemble.terminal_theme_id`
- Server 联调后：启动时 `GET /api/v1/user/preferences` 同步；Settings 保存时 `PUT` 回 Server（失败仍写 local，不阻塞 UI）

## 6. Runtime 热切换（P0）

### 6.1 行为

用户在 Settings 选择新 theme 后 **立即**：

1. 持久化 `terminal_theme_id`
2. 更新全局 `TerminalThemeContext`（或等价 event bus）
3. 所有 `AgentConsole` 实例：
   - `terminal.options.theme = preset.xterm`
   - `terminal.options.minimumContrastRatio = 7`（保留）
   - `terminal.refresh(0, terminal.rows - 1)` 重绘 scrollback
   - 容器 `backgroundColor` = `preset.xterm.background`
   - 注入 CSS 变量 `--xterm-bg`（供 `index.css` `.xterm-viewport` 使用）

### 6.2 促 Agent 重绘输入区（不 kill session）

热切换后 optional 但推荐：

- 对当前 session 的 WebSocket 发送 `{ type: 'resize', cols, rows }`（尺寸不变亦可），促使 TUI 整屏重绘。
- 不发送 `clear`、不 dispose terminal。

### 6.3 限制（需在 UI 说明）

**dark ↔ light** 的 `appearance` 切换时，Agent 进程内 spawn env（`COLORFGBG`）无法变，输入条颜色可能与 xterm 背景不一致。此时 toast：

> 明暗主题切换需新开 session 后 Agent 输入条才能完全同步。

**dark → dark**（Nord ↔ Dracula）为常态路径，热切换即完整体验，无需重开 session。

## 7. Settings UI

位置：`SettingsShell` 新增 **Terminal** 分区（或 General 内子区块）。

内容：

- 下拉选择 preset（label + 小色条预览：背景 + 红/绿/蓝样例）
- 数据源：优先 `GET /api/v1/terminal-themes`，失败 fallback 本地 `terminalThemes.js`
- 切换即保存 + 触发热切换（§6）
- 文案：「终端配色立即生效；若 Agent 输入条未更新，可尝试切换 workspace 或新开 session。」

## 8. AgentConsole 改造

| 文件 | 改动 |
|---|---|
| `AgentConsole.jsx` | 从 context 读 preset；创建/更新 Terminal theme；监听 theme 变化 |
| `consoleTheme.js` | 保留 re-export 或 deprecate 硬编码 `xtermTheme`，改从 `terminalThemes.js` 读取 |
| `index.css` | `.xterm-viewport { background-color: var(--xterm-bg, #2E3440); }` |
| `SessionsPage.jsx` | `POST /session/start`、`restart` body 增加 `terminal_theme_id` |

Off-route 挂载的 `SessionsPage` / `AgentConsole` 必须订阅同一 context，保证切 route 后 session 仍存活且 theme 一致。

## 9. 与 Server 联调

| 时机 | Desktop 行为 |
|---|---|
| Session start | Body: `{ agent_id, project_id, terminal_theme_id }` |
| 偏好同步 | `GET/PUT /api/v1/user/preferences` |
| Catalog | `GET /api/v1/terminal-themes` |

`terminal_theme_id` 解析优先级（与 Server 一致）：请求 body > 用户偏好 > 平台默认 > `nord`。

## 10. Task List

### P0 — 热切换与本地 catalog

- [ ] **D1** `terminalThemes.js` — 3 个 preset + 工具函数
- [ ] **D2** `terminalThemes.test.js` — 字段完整性、`appearance` 与 `spawnEnv.COLORFGBG` 一致
- [ ] **D3** `terminalPrefs.js` — localStorage 读写
- [ ] **D4** `TerminalThemeContext` — provider + `useTerminalTheme()` hook
- [ ] **D5** `AgentConsole` — 订阅 context，创建/热更新 theme + refresh + `--xterm-bg`
- [ ] **D6** 热切换后 optional resize ping（WebSocket `resize`）
- [ ] **D7** Settings → Terminal 下拉 + 预览 + 即时生效
- [ ] **D8** `index.css` viewport 改用 CSS 变量

### P1 — Server 联调

- [ ] **D9** Settings 保存 / App 启动同步 `user/preferences`
- [ ] **D10** `session/start`、`restart` 携带 `terminal_theme_id`
- [ ] **D11** Settings 下拉优先 Server catalog

### P2 —  polish

- [ ] **D12** `appearance` dark↔light 切换时 toast 提示
- [ ] **D13** 更新 `AGENTS.md`、`DESIGN.md` 终端配色说明
- [ ] **D14** 扩展 preset 数量（Gruvbox、Catppuccin 等）

## 11. 验收标准

1. Settings 从 Nord 切到 Dracula，**当前**终端 scrollback 与背景 **立即**变色，无需重开 session。
2. 切换后新输入的字符使用新 theme 配色。
3. 在 Sessions 与 Admin 页之间切换 route，已运行 session 的 theme 与 Settings 一致。
4. 新开 session 时 Server 收到正确 `terminal_theme_id`（联调后）。
5. dark preset 间切换不出现「必须重启 session」的阻断提示。

## 12. 依赖

- Server 文档：[terminal-theme-server-requirements.md](./terminal-theme-server-requirements.md)
- P0 可独立于 Server 交付；P1 需 Server S6–S12 就绪。
