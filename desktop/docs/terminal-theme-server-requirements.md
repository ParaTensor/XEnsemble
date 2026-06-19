# Terminal Theme — XEnsemble Server 需求文档

> 关联文档：[terminal-theme-desktop-requirements.md](./terminal-theme-desktop-requirements.md)  
> 配色参考：[terminalcolors.com](https://terminalcolors.com/)  
> Cursor Agent 主题探测：[Terminal Setup](https://cursor.com/docs/cli/reference/terminal-setup)

## 1. 背景

Cursor Agent 等 CLI 通过 **OSC 11** 探测终端背景，决定 TUI 输入条用 dark 还是 light 样式。Agent 跑在服务端 **node-pty** 上时探测失败，会误用浅色输入条（白底浅字）。

官方 workaround：spawn 时注入 `COLORFGBG`：

- Dark：`COLORFGBG=15;0`
- Light：`COLORFGBG=0;15`

Desktop 端 xterm 可 runtime 热切换完整配色（Nord、Dracula 等），但 **Agent 进程的 spawn env 在 PTY 创建后不可变**。Server 职责是：

1. 在 **session start** 时根据用户/平台 theme 选择注入正确 `COLORFGBG`。
2. 修复现有 BYOK spawn 路径不合并 `env_overrides` 的问题。
3. 提供 catalog 与用户偏好 API，供 Desktop / Web Console 同步。

**说明**：用户日常在 dark preset 间换肤由 Desktop 热切换完成；Server 保证 **新 session** spawn env 与 theme 一致，以及 dark↔light 切换时新 session 行为正确。

## 2. 目标

1. 平台级默认 terminal theme + 用户级 `terminal_theme_id` 偏好。
2. `POST /api/v1/session/start` 解析 theme 并合并 spawn env（含 `COLORFGBG`）。
3. BYOK 与 Gateway 均应用 `env_overrides` 与 terminal spawn env。
4. 暴露 terminal theme catalog API（与 Desktop preset ID 对齐）。
5. Admin 可配置平台默认 theme、可选禁用部分 preset。

## 3. 非目标

- 不在 Server 实现 OSC 11 应答或 ANSI 流改写。
- 不尝试 runtime 修改已运行 PTY 的环境变量（不可能）。
- 不在 Server 维护完整 xterm `ITheme` 对象（仅 `appearance` + `spawn_env`；完整 palette 由 Desktop catalog 持有，或 Server 只存 metadata）。

## 4. Theme Catalog

### 4.1 存储

`server/data/terminal-themes.json`（或 `src/config/terminalThemes.json`）：

```json
{
  "themes": [
    {
      "id": "nord",
      "label": "Nord",
      "appearance": "dark",
      "enabled": true,
      "spawn_env": {
        "COLORFGBG": "15;0",
        "COLORTERM": "truecolor"
      }
    },
    {
      "id": "dracula",
      "label": "Dracula",
      "appearance": "dark",
      "enabled": true,
      "spawn_env": { "COLORFGBG": "15;0" }
    },
    {
      "id": "solarized-light",
      "label": "Solarized Light",
      "appearance": "light",
      "enabled": false,
      "spawn_env": { "COLORFGBG": "0;15" }
    }
  ],
  "default_id": "nord"
}
```

MVP 至少启用 3 个 dark preset；light preset 可先 `enabled: false`。

### 4.2 解析规则

```text
effective_theme_id =
  request.body.terminal_theme_id
  ?? user.preferences.terminal_theme_id
  ?? platform_settings.default_terminal_theme_id
  ?? catalog.default_id
  ?? 'nord'
```

校验 `enabled`；非法 ID 回退 default 并 log warn。

从 preset 取 `spawn_env` 合并进 `resolved.env`。

## 5. Spawn 环境合并顺序

```text
process.env
→ platform terminal 默认 spawn_env（来自 default theme 或 platform_settings）
→ 用户 effective theme 的 spawn_env
→ agent env_required 密钥（BYOK / gateway vault）
→ agent env_overrides（含 Admin 配置的 COLORFGBG 覆盖）
→ LocalExecAdapter 固定项：TERM=xterm-256color（若未设置）
```

后者覆盖前者。`LocalExecAdapter` **不得**硬编码不可覆盖的 `COLORFGBG`。

## 6. 数据模型

### 6.1 用户偏好

任选其一：

- 新表 `user_preferences (user_id, key, value)`，或
- `users` 表增加 `preferences_json TEXT`

字段：

```json
{ "terminal_theme_id": "nord" }
```

### 6.2 平台设置

扩展现有 `platform_settings`：

```json
{
  "default_terminal_theme_id": "nord",
  "disabled_terminal_theme_ids": []
}
```

## 7. API

### 7.1 Catalog

```
GET /api/v1/terminal-themes
Authorization: Bearer <token>
```

Response：

```json
{
  "default_id": "nord",
  "themes": [
    { "id": "nord", "label": "Nord", "appearance": "dark" }
  ]
}
```

不返回完整 xterm palette（Desktop 自带）；若未来 Web Console 需要可另加 `include=palette`。

### 7.2 用户偏好

```
GET  /api/v1/user/preferences
PUT  /api/v1/user/preferences
Body: { "terminal_theme_id": "dracula" }
```

### 7.3 Session Start（扩展）

```
POST /api/v1/session/start
Body: {
  "agent_id": "cursor",
  "project_id": "...",
  "terminal_theme_id": "dracula"   // 可选，覆盖用户偏好
}
```

响应可附带（可选，便于调试）：

```json
{
  "session_id": "...",
  "terminal_theme_id": "dracula",
  "spawn_env_preview": { "COLORFGBG": "15;0" }
}
```

### 7.4 Admin

- `GET/PUT /api/v1/admin/platform-settings` — 增加 `default_terminal_theme_id`、`disabled_terminal_theme_ids`
- 现有 `PUT /api/v1/admin/gateway/agent-configs/:agentId` — `env_overrides.COLORFGBG` 文档化，用于 per-agent 覆盖

### 7.5 Spawn Preview（可选 P2）

扩展 `GET /api/v1/admin/agents/:id/gateway-spawn-preview` 或新增：

```
GET /api/v1/session/spawn-preview?agent_id=cursor&terminal_theme_id=nord
```

返回 `effective_spawn_env`（含 `COLORFGBG`、来源 theme id）。

## 8. 代码改动点

| 模块 | 改动 |
|---|---|
| `server/src/agents/agentEnv.js` | 新增 `resolveTerminalSpawnEnv(themeId)`；`resolveSpawnEnv` BYOK/Gateway 均调用；合并 `env_overrides` |
| `server/src/runtime/LocalExecAdapter.js` | 移除硬编码 `COLORFGBG`；使用 `resolved.env` |
| `server/src/server.js` | `session/start` 解析 `terminal_theme_id` |
| `server/src/routes/` | 新增 terminal-themes、user preferences 路由 |
| `server/src/admin/` | platform settings 扩展 |
| `server/data/terminal-themes.json` | catalog 文件 |

## 9. Task List

### P0 — Spawn 修复与 session 联动

- [ ] **S1** `resolveSpawnEnv`：BYOK 路径合并 `agent_gateway_config.env_overrides`
- [ ] **S2** `LocalExecAdapter`：`COLORFGBG` / `COLORTERM` 来自 merged env，去掉硬编码默认值
- [ ] **S3** 实现 `terminal-themes.json` + `loadTerminalTheme(id)`
- [ ] **S4** `resolveTerminalSpawnEnv(themeId)` + 合并顺序（§5）
- [ ] **S5** `POST /session/start` 接受 `terminal_theme_id`，按 §4.2 解析并注入 spawn env
- [ ] **S6** `GET /api/v1/terminal-themes`

### P1 — 用户与平台偏好

- [ ] **S7** 用户偏好存储 + `GET/PUT /api/v1/user/preferences`
- [ ] **S8** Admin：`default_terminal_theme_id` + `disabled_terminal_theme_ids`
- [ ] **S9** theme 解析优先级与 `enabled` 校验

### P2 — Admin 与可观测性

- [ ] **S10** spawn preview 返回 `effective_spawn_env`
- [ ] **S11** Admin 文档：`env_overrides` per-agent 覆盖 terminal env
- [ ] **S12** 单测：BYOK + `env_overrides.COLORFGBG`；theme 优先级；disabled theme 回退
- [ ] **S13** 更新 `docs/ApiClient.md`

## 10. 验收标准

1. 用户偏好 `dracula`，新开 Cursor Agent session，`spawn env` 含 `COLORFGBG=15;0`。
2. BYOK 的 `cursor` agent 在 Admin 配置 `env_overrides: { "COLORFGBG": "0;15" }` 后，新 session 使用 light（覆盖用户 dark preset）。
3. `terminal_theme_id` 请求体覆盖用户偏好。
4. 禁用 preset 时自动回退 `default_id`。
5. 已有 running session **不**因用户改偏好而改变 PTY env（符合预期；Desktop 负责 xterm 热切换）。

## 11. 与 Desktop 分工

| 能力 | Desktop | Server |
|---|---|---|
| xterm 完整配色（Nord/Dracula） | ✅ 热切换 | — |
| scrollback 即时换色 | ✅ | — |
| Agent 输入条 dark/light | 热切换 + resize 促重绘（dark↔dark） | 新 session spawn env |
| dark↔light Agent 完全同步 | toast 提示新开 session | 新 session 正确 `COLORFGBG` |
| 用户偏好 UI | Settings | API 持久化 |
| Theme catalog 完整 palette | `terminalThemes.js` | metadata + `spawn_env` |

## 12. 临时方案（UI 未上线前）

在 S1–S5 完成前，可保留 `LocalExecAdapter` 默认 `COLORFGBG=15;0` 作为全局 dark fallback；S2 完成后改为仅 platform default theme 注入。

Admin 手动覆盖（需 S1）：

```bash
curl -X PUT "$BASE/api/v1/admin/gateway/agent-configs/cursor" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"env_overrides":{"COLORFGBG":"15;0"}}'
```

## 13. 依赖

- Desktop 文档：[terminal-theme-desktop-requirements.md](./terminal-theme-desktop-requirements.md)
- Desktop P1（D9–D11）依赖本文档 S5–S8。
