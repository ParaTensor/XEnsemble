# Native Desktop Layout 重构设计文档

## 1. 背景与目标

当前 Console 页面虽然已改为 Morandi 浅色主题，但仍然像一个传统 Web Dashboard：左侧 workspace 面板和中间终端被包裹在带边框的白色卡片内，顶部还有一条独立的 "XEnsemble" header bar。用户希望改为类似 Linear、Cursor、Slack 的 Native Desktop 应用 aesthetic：

- 整个窗口是统一的画布，左右通过背景色无缝分割，而不是浮动卡片。
- 左侧 Sidebar 通顶通底，包含顶部视觉元素、Workspaces 树、底部 Admin 链接和用户资料。
- 右侧 Main Area 是纯白画布，终端/空状态直接放在画布上，没有内层 card 或边框。
- 不改动 Electron main process，保留原生 title bar。

## 2. 设计哲学

- **Unified Canvas**：取消所有 floating cards、rounded containers、heavy shadows。
- **2-Tone Split**：Sidebar `#F4F5F6` + Main `#FFFFFF`，仅靠背景色区分区域。
- **Vertical Sidebar**：左侧是应用真正的 "wing"，顶部对齐窗口，底部固定用户区。
- **Content-First**：右侧白色画布完全交给内容，终端保持深色以形成焦点。

## 3. 色彩与间距

| 区域 | 背景色 | 说明 |
|---|---|---|
| Sidebar | `#F4F5F6` | 左侧固定栏，cool grey |
| Main Area | `#FFFFFF` | 右侧主画布，pure white |
| Sidebar divider | `#E8EAED` | 仅用于底部用户区顶部的发丝分隔线 |
| Text primary | `#202124` | 工作区名称、品牌文字 |
| Text secondary | `#5F6368` | 分组标题、Admin 链接 |
| Text placeholder | `#9AA0A6` | 空状态提示 |
| Accent green | `#4A7C59` | 运行中计数 |
| Window dots | `#FF5F57`, `#FEBC2E`, `#28C840` | 仅用于未来 frameless 模式；当前保留原生 title bar，不显示 |

- Sidebar 宽度：`260px`（固定，不折叠）。
- Sidebar 顶部 padding：`16px`。
- Sidebar 顶部：仅显示 `XEnsemble` 品牌文字，不显示自定义 window dots（避免与 macOS 原生 title bar 按钮重叠）。
- Workspaces 分组标题：`text-[10px] uppercase tracking-wider text-[#5F6368]`。
- Workspaces 行：`text-xs text-[#202124]`，`hover:bg-[#E8EAED]`，`rounded-md`。
- 底部 Admin 链接：`text-xs text-[#5F6368]`，`hover:text-[#202124]`。
- 右侧 Main Area：无 padding、无 border、无 shadow。
- 空状态：在 Main Area 内水平和垂直居中。
- 深色终端容器：外层无圆角/边框/阴影，但内部 xterm 实例四周保留 `p-4` 内边距，避免字符紧贴白色画布边缘。

## 4. 组件架构

### 4.1 App.jsx

- 移除顶部 `<header>` 及其内部导航（Sessions / Users / Agents / UserMenu）。
- 改为 `h-full flex` 的根布局：
  ```jsx
  <div className="h-full flex">
    <AppSidebar
      agents={agents}
      projects={projects}
      sessions={sessions}
      activeSession={activeSession}
      user={user}
      ...
    />
    <main className="flex-1 relative min-w-0 bg-white">
      {/* off-route mounted pages */}
      <SessionsPage ... className={isSessions ? '' : offRouteClass} />
      {user?.role === 'admin' && (
        <>
          <AgentsAdmin ... className={isAgentsAdmin ? '' : offRouteClass} />
          <UsersAdmin ... className={isUsersAdmin ? '' : offRouteClass} />
        </>
      )}
    </main>
  </div>
  ```
- 负责通过 `useWorkspaces` 拉取并维护 `agents`、`projects`、`sessions`、`activeSession` 状态。
- Settings modal 仍在 App.jsx 级别触发。

### 4.2 AppSidebar.jsx（新增）

`src/renderer/components/AppSidebar.jsx`

props：`agents`, `projects`, `sessions`, `activeSession`, `onSelectSession`, `onCreateWorkspace`, `onOpenSettings`, `onLogout`, `user`

结构：
```jsx
<aside className="h-full w-[260px] bg-[#F4F5F6] flex flex-col flex-shrink-0 select-none">
  {/* Top: brand only (no fake window dots on macOS / Windows native title bar) */}
  <div className="px-4 pt-4 pb-3 flex items-center">
    <span className="text-sm font-bold text-[#202124]">XEnsemble</span>
  </div>

  {/* Middle: workspaces tree */}
  <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
    <WorkspaceTree ... />
  </div>

  {/* Bottom: admin links + user profile */}
  <div className="border-t border-[#E8EAED] px-3 py-3 space-y-1">
    <NavLink to="/admin/users">Users</NavLink>
    <NavLink to="/admin/agents">Agents</NavLink>
    <UserProfile user={user} onSettings={onOpenSettings} onLogout={onLogout} />
  </div>
</aside>
```

- `WorkspaceTree` 逻辑从原 `Console.jsx` 迁移而来。
- Admin 链接仅对 `user?.role === 'admin'` 显示。

### 4.3 useWorkspaces.js（新增）

`src/renderer/hooks/useWorkspaces.js`

职责：
- 接收 `token`。
- fetch `/api/v1/agents`、`/api/v1/projects`、`/api/v1/sessions`。
- 每 5 秒轮询一次。
- 维护 `activeSession` 状态（包括从缓存恢复、切换、结束、重启时的更新）。
- 返回 `{ agents, projects, sessions, activeSession, setActiveSession, fetchWorkspaces, ... }`。

### 4.4 SessionsPage.jsx（由 Console.jsx 重命名）

`src/renderer/pages/SessionsPage.jsx`

- 从 `src/renderer/pages/Console.jsx` 重命名。
- 移除左侧 workspace 面板、Pinned/Recently 分组、workspace 创建/删除逻辑（迁移到 AppSidebar）。
- 只负责右侧 Main Area：
  - 无活动会话：居中空状态。
  - 有活动会话：渲染 `AgentConsole` + 可选文件面板。
- 通过 props 从 App.jsx 接收 `agents`、`projects`、`sessions`、`activeSession`、`setActiveSession`、`token`。
- 保留会话控制逻辑：`handleStartSession`、`handleStopSession`、`handleRestartSession`、文件面板开关等。

### 4.5 AgentConsole.jsx

`src/renderer/components/AgentConsole.jsx`

- 移除外层 `bg-zinc-950 rounded-lg border border-zinc-800 shadow-xl` 的 card 包裹。
- 外层改为 `h-full flex flex-col bg-white`。
- 顶部状态栏改为浅色主题：背景 `#FAFBFC`，底部边框 `#E8EAED`，文字 `#5F6368`。
- 终端容器区域保持深色 `#09090b`，无圆角，紧贴状态栏和底部。
- 终端容器内部（xterm 实例四周）保留 `p-4` 内边距，避免字符紧贴白色画布边缘。
- 终端主题保持 `background: '#09090b'`，`foreground: '#f4f4f5'`。

## 5. Admin 页面

- `AgentsAdmin.jsx` 和 `UsersAdmin.jsx` 不再拥有自己的 sidebar 或 header。
- 它们只渲染右侧主区域的内容，由 App.jsx 统一提供 `AppSidebar`。
- 需要移除/调整任何依赖旧 `APP_SHELL_MAX_CLASS` 等 shell padding 的样式，使其在白色画布中自然显示。

## 6. 路由与挂载

- 保留现有路由定义。
- 保留 AuthenticatedLayout 的 off-route 模式，让 `SessionsPage` 在 Admin 页面激活时仍然 mounted 但不可见，避免终端会话被销毁。
- Admin 页面同样 off-route mounted，保持表单状态。

## 7. 排除项

- 不改为 frameless window。
- 不修改 Electron main process 的窗口控制逻辑。
- 不引入第三方窗口管理库。
- 不改动终端的深色主题。
- 不改动业务 API 和 WebSocket 逻辑。

## 8. 验收标准

- [ ] App.jsx 没有顶部 header bar。
- [ ] 窗口显示为左右两栏统一画布：左侧 `#F4F5F6`，右侧 `#FFFFFF`。
- [ ] 左侧 Sidebar 通顶通底，宽度固定 `260px`，无外边距和圆角。
- [ ] Sidebar 顶部仅显示 `XEnsemble` 品牌文字（不显示自定义 window dots，避免与原生 title bar 重叠）。
- [ ] Sidebar 中部显示 Workspaces 树。
- [ ] Sidebar 底部显示 Admin 链接（Users/Agents）和用户资料/设置。
- [ ] 右侧 Main Area 没有内层 card、border、shadow。
- [ ] 无活动会话时，空状态提示在白色画布中居中。
- [ ] 有活动会话时，`AgentConsole` 占满右侧区域，终端保持深色，xterm 实例四周保留 `p-4` 内边距。
- [ ] `Console.jsx` 已重命名为 `SessionsPage.jsx`。
- [ ] 所有相关 import 路径已更新。
- [ ] `npm run build` 和 `npm run package:dir` 成功。
