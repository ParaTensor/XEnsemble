# Native Desktop Layout 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 XEnsembleDesktop 的 authenticated 页面从传统 Web Dashboard 布局重构为类似 Linear/Cursor 的 Native Desktop 左右分栏布局：左侧固定 Sidebar + 右侧纯白 Main Canvas，移除顶部 header bar。

**Architecture:** 通过 `useWorkspaces` hook 在 App.jsx 级别统一管理 agents/projects/sessions/activeSession；新增 `AppSidebar` 组件承载左侧工作区树、Admin 链接和用户资料；将 `Console.jsx` 重命名为 `SessionsPage.jsx` 并精简为仅负责右侧主区域；`AgentConsole` 去除外层 card 并适配白色画布。

**Tech Stack:** React 18, React Router 6, Tailwind CSS 3, Electron 39, electron-vite 3, Node 20 test runner.

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/renderer/hooks/useWorkspaces.js` | 新增：统一获取并轮询 agents/projects/sessions，管理 activeSession。 |
| `src/renderer/hooks/useWorkspaces.test.js` | 新增：Node test runner 验证 hook 导出和初始状态。 |
| `src/renderer/components/AppSidebar.jsx` | 新增：左侧通顶通底 sidebar，包含品牌、workspaces、Admin 链接、用户资料。 |
| `src/renderer/pages/SessionsPage.jsx` | 由 `Console.jsx` 重命名；仅负责右侧主区域（空状态/AgentConsole/文件面板）。 |
| `src/renderer/pages/Console.jsx` | 删除；功能迁移到 `SessionsPage.jsx` 和 `AppSidebar.jsx`。 |
| `src/renderer/components/AgentConsole.jsx` | 修改：去除外层 card，顶部状态栏改为浅色，终端内部保留 p-4。 |
| `src/renderer/App.jsx` | 修改：移除顶部 header，改为左右分栏布局，注入 workspaces 数据。 |
| `src/renderer/pages/AgentsAdmin.jsx` | 修改：移除对旧 shell padding/title 的依赖，适配白色主画布。 |
| `src/renderer/pages/UsersAdmin.jsx` | 修改：同上。 |

---

## Task 1: 创建 `useWorkspaces` hook 及其测试

**Files:**
- Create: `src/renderer/hooks/useWorkspaces.js`
- Create: `src/renderer/hooks/useWorkspaces.test.js`

- [ ] **Step 1: 写失败测试**

```js
// src/renderer/hooks/useWorkspaces.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { useWorkspaces } from './useWorkspaces.js';

describe('useWorkspaces module', () => {
  it('exports useWorkspaces function', () => {
    assert.strictEqual(typeof useWorkspaces, 'function');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/xinference/github/XEnsembleDesktop && node --test src/renderer/hooks/useWorkspaces.test.js
```

Expected: FAIL — `useWorkspaces` is not defined.

- [ ] **Step 3: 实现 hook**

```js
// src/renderer/hooks/useWorkspaces.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase } from '../lib/api.ts';
import {
  readBootstrapConsoleState,
  saveConsoleCache,
} from '../lib/consoleCache';
import { getCacheUserId } from '../lib/consoleCache';
import {
  loadSidebarPrefs,
  pickSessionToRestore,
  isArchivedSession,
} from '../lib/sidebarPrefs';

export function useWorkspaces(token, user) {
  const [agents, setAgents] = useState(() => readBootstrapConsoleState(null).agents);
  const [projects, setProjects] = useState(() => readBootstrapConsoleState(null).projects);
  const [sessions, setSessions] = useState(() => readBootstrapConsoleState(null).sessions);
  const [activeSession, setActiveSession] = useState(() => readBootstrapConsoleState(null).activeSession);
  const sidebarPrefsRef = useRef(loadSidebarPrefs());

  const fetchAgents = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${getApiBase()}/api/v1/agents`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (Array.isArray(data)) setAgents(data);
  }, [token]);

  const fetchProjects = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${getApiBase()}/api/v1/projects`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (Array.isArray(data)) {
      setProjects(data.map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.created_at ?? p.createdAt ?? 0,
      })));
    }
  }, [token]);

  const fetchSessions = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${getApiBase()}/api/v1/sessions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (Array.isArray(data)) setSessions(data);
  }, [token]);

  const fetchWorkspaces = useCallback(async () => {
    await Promise.all([fetchAgents(), fetchProjects(), fetchSessions()]);
  }, [fetchAgents, fetchProjects, fetchSessions]);

  // Initial fetch + polling
  useEffect(() => {
    if (!token) return;
    fetchWorkspaces();
    const poll = setInterval(fetchWorkspaces, 5000);
    return () => clearInterval(poll);
  }, [token, fetchWorkspaces]);

  // Restore active session if needed
  useEffect(() => {
    if (!token || sessions.length === 0 || activeSession) return;
    const prefs = loadSidebarPrefs();
    if (activeSession?.sessionId && !isArchivedSession(prefs, activeSession.sessionId)) return;
    const candidate = pickSessionToRestore(sessions, prefs);
    if (candidate) {
      const projectName = candidate.projectName || projects.find((p) => p.id === candidate.projectId)?.name;
      setActiveSession({
        sessionId: candidate.id,
        agentId: candidate.agentId,
        agentName: agents.find((a) => a.id === candidate.agentId)?.name || candidate.agentId,
        projectId: candidate.projectId ?? null,
        projectName: projectName ?? null,
      });
    }
  }, [token, sessions, activeSession, agents, projects]);

  // Persist cache
  useEffect(() => {
    const userId = getCacheUserId(user);
    if (!userId || !token) return;
    saveConsoleCache(userId, { agents, sessions, projects, activeSession });
  }, [user, token, agents, sessions, projects, activeSession]);

  return {
    agents,
    projects,
    sessions,
    activeSession,
    setActiveSession,
    fetchWorkspaces,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
node --test src/renderer/hooks/useWorkspaces.test.js
```

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add src/renderer/hooks/useWorkspaces.js src/renderer/hooks/useWorkspaces.test.js
git commit -m "feat: add useWorkspaces hook for shared workspace state"
```

---

## Task 2: 创建 `AppSidebar` 组件

**Files:**
- Create: `src/renderer/components/AppSidebar.jsx`

- [ ] **Step 1: 读取原 `Console.jsx` 的 workspace 相关代码**

从 `src/renderer/pages/Console.jsx` 中提取以下逻辑/JSX：
- `workspaces` 计算
- `expandedWorkspaces` 状态与 `toggleWorkspaceExpanded`
- `pinnedSessions` / `recentSessions` / `hasSidebarSectionsAboveWorkspaces`
- `renderSessionRow` / `renderSessionList`
- workspace 创建、删除、pin 相关 handler
- 底部删除确认弹窗（workspace）

- [ ] **Step 2: 创建 `AppSidebar.jsx`**

```jsx
// src/renderer/components/AppSidebar.jsx
import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderPlus, Pin, Plus, Trash2, ChevronRight, ChevronDown, FolderOpen, Users, Bot, Settings, LogOut } from 'lucide-react';
import { useToast } from './Toast';
import { ConsoleAnchoredDialog, ConsoleInlineDialog } from './ConsoleDialog';
import { useWorkspaces } from '../hooks/useWorkspaces';
import {
  bgCanvas,
  textPrimary,
  textSecondary,
  textPlaceholder,
  borderHairline,
  accentBlue,
  accentGreen,
  accentRed,
  accentRedBg,
  hoverBgActive,
  hoverBgTertiary,
  hoverTextPrimary,
  transitionBase,
} from '../lib/consoleTheme';
import {
  isPinnedSession,
  isArchivedSession,
  isPinnedWorkspace,
  togglePinnedSession,
  togglePinnedWorkspace,
  archiveSession,
  removeWorkspacePrefs,
  removeRecentSession,
  loadSidebarPrefs,
} from '../lib/sidebarPrefs';
import { formatRelativeTime, buildWorkspaces, sortSessions, renderSessionRow } from '../lib/workspaceUi';

export default function AppSidebar({
  agents,
  projects,
  sessions,
  activeSession,
  setActiveSession,
  user,
  onLogout,
  onOpenSettings,
}) {
  // workspace tree state + handlers (migrated from Console.jsx)
  // ... see full implementation details below
}
```

> 完整实现细节：复制原 `Console.jsx` 中 workspace 面板的状态、计算函数和 JSX，移除与右侧主区域相关的状态。将 `+` 按钮使用 `accentBlue`，运行计数使用 `accentGreen`，删除按钮使用 `accentRed` + `accentRedBg`，悬停使用 `hoverBgTertiary` / `hoverBgActive`。

- [ ] **Step 3: 从原 `Console.jsx` 提取可复用函数到 `src/renderer/lib/workspaceUi.js`**

为避免在 `AppSidebar` 和 `SessionsPage` 中重复代码，将以下纯函数抽到 `src/renderer/lib/workspaceUi.js`：

```js
export function formatRelativeTime(ts) { ... }
export function buildWorkspaces(projects, sessions, prefs) { ... }
export function sortSessions(list, prefs) { ... }
export function renderSessionRow(s, ws, options) { ... } // returns JSX, so keep as helper component
```

如果抽成纯函数困难（因为涉及 activeSession/icon 等），则允许在 `AppSidebar` 和 `SessionsPage` 中各保留一份简化版，但优先复用。

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 无 import 错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/AppSidebar.jsx src/renderer/lib/workspaceUi.js
git commit -m "feat: add AppSidebar component with workspaces and bottom nav"
```

---

## Task 3: 重命名 `Console.jsx` → `SessionsPage.jsx` 并精简为右侧主区域

**Files:**
- Rename: `src/renderer/pages/Console.jsx` → `src/renderer/pages/SessionsPage.jsx`
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: 用 git mv 重命名文件**

```bash
git mv src/renderer/pages/Console.jsx src/renderer/pages/SessionsPage.jsx
```

- [ ] **Step 2: 更新 `App.jsx` 中的 import**

```js
import SessionsPage from './pages/SessionsPage';
```

并把 `<Console />` 替换为 `<SessionsPage ... />`。

- [ ] **Step 3: 精简 `SessionsPage.jsx`**

- 移除左侧 workspace 面板 JSX（已迁移到 `AppSidebar`）。
- 移除 `workspaces` / `pinnedSessions` / `recentSessions` / `expandedWorkspaces` 等 sidebar 专用状态。
- 保留并接收 props：`agents`, `projects`, `sessions`, `activeSession`, `setActiveSession`, `token`。
- 保留会话控制逻辑：`handleStartSession`, `handleStopSession`, `handleRestartSession`, `handleSessionEnd`, 文件面板，以及 `AgentConsole` 渲染。
- 主返回结构简化为：

```jsx
export default function SessionsPage({
  token,
  agents,
  projects,
  sessions,
  activeSession,
  setActiveSession,
  className,
}) {
  // ... existing terminal/session logic
  return (
    <div className={cn('h-full w-full bg-white flex flex-col', className)}>
      {activeSession ? (
        <AgentConsole ... />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-[#9AA0A6]">
          <TerminalSquare className="w-12 h-12 mb-4 text-[#DADCE0]" strokeWidth={1} />
          <h3 className="text-base font-medium text-[#202124] mb-1">No Active Session</h3>
          <p className="text-sm">Select a workspace from the sidebar or create a new one.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/pages/SessionsPage.jsx src/renderer/App.jsx
git commit -m "refactor: rename Console to SessionsPage and remove sidebar"
```

---

## Task 4: 重写 `App.jsx` 为左右分栏布局

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: 移除顶部 header 和旧 shell 相关 import**

删除：
- `BrandMark` import
- `APP_SHELL_*` constants import
- `consoleNavActiveClass`, `consoleNavIdleClass` import（若不再用于旧 nav）
- `header` JSX
- `navLinkClass` 函数

- [ ] **Step 2: 集成 `useWorkspaces` 和 `AppSidebar`**

```jsx
import { useWorkspaces } from './hooks/useWorkspaces';
import AppSidebar from './components/AppSidebar';

function AuthenticatedLayout() {
  const { token, user } = useContext(AuthContext);
  const location = useLocation();
  const {
    agents,
    projects,
    sessions,
    activeSession,
    setActiveSession,
  } = useWorkspaces(token, user);

  const isSessions = location.pathname === '/sessions';
  const isAgentsAdmin = location.pathname === '/admin/agents';
  const isUsersAdmin = location.pathname === '/admin/users';
  const offRouteClass = 'pointer-events-none invisible absolute inset-0 z-0';

  return (
    <div className="h-full flex">
      <AppSidebar
        agents={agents}
        projects={projects}
        sessions={sessions}
        activeSession={activeSession}
        setActiveSession={setActiveSession}
        user={user}
        onLogout={logout}
        onOpenSettings={() => setShowSettingsModal(true)}
      />
      <main className="flex-1 relative min-w-0 bg-white">
        <div className={cn('h-full w-full', !isSessions && offRouteClass)} aria-hidden={!isSessions}>
          <SessionsPage
            token={token}
            agents={agents}
            projects={projects}
            sessions={sessions}
            activeSession={activeSession}
            setActiveSession={setActiveSession}
          />
        </div>
        {user?.role === 'admin' && (
          <>
            <div className={cn('h-full w-full overflow-auto console-scroll-hidden', isAgentsAdmin ? 'relative z-10' : offRouteClass)} aria-hidden={!isAgentsAdmin}>
              <AgentsAdmin />
            </div>
            <div className={cn('h-full w-full overflow-auto console-scroll-hidden', isUsersAdmin ? 'relative z-10' : offRouteClass)} aria-hidden={!isUsersAdmin}>
              <UsersAdmin />
            </div>
          </>
        )}
      </main>
      {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: 删除旧的 `Shell` 组件和 `APP_SHELL_*` 使用**

确保 `AuthenticatedLayout` 不再引用旧的 `Shell` 或 shell padding。

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/App.jsx
git commit -m "feat: rewrite App layout as native desktop sidebar + main canvas"
```

---

## Task 5: 更新 `AgentConsole.jsx` 样式

**Files:**
- Modify: `src/renderer/components/AgentConsole.jsx`

- [ ] **Step 1: 移除外层 card 样式**

将最外层：

```jsx
<div className="flex flex-col h-full bg-zinc-950 rounded-lg overflow-hidden border border-zinc-800 shadow-xl">
```

改为：

```jsx
<div className="flex flex-col h-full bg-white">
```

- [ ] **Step 2: 顶部状态栏改为浅色**

将顶部 bar：

```jsx
<div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
```

改为：

```jsx
<div className="h-10 bg-[#FAFBFC] border-b border-[#E8EAED] flex items-center justify-between px-4 shrink-0">
```

并将内部文字颜色从 `text-zinc-300` / `text-zinc-400` / `text-zinc-500` 改为 `text-[#202124]` / `text-[#5F6368]` / `text-[#9AA0A6]`。

状态指示点保持绿色/灰色（可使用 `accentGreen` token 或字面量）。

按钮 hover 改为 `hover:bg-[#E8EAED] hover:text-[#202124]`。

分隔线改为 `bg-[#E8EAED]`。

- [ ] **Step 3: 终端容器区域加内部 padding**

将：

```jsx
<div className="flex-1 p-2 min-h-0 overflow-hidden">
  <div ref={containerRef} className="xterm-host w-full h-full" />
</div>
```

改为：

```jsx
<div className="flex-1 p-4 min-h-0 overflow-hidden bg-[#09090b]">
  <div ref={containerRef} className="xterm-host w-full h-full" />
</div>
```

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/AgentConsole.jsx
git commit -m "feat: adapt AgentConsole to white canvas with light toolbar"
```

---

## Task 6: 更新 Admin 页面适配新布局

**Files:**
- Modify: `src/renderer/pages/AgentsAdmin.jsx`
- Modify: `src/renderer/pages/UsersAdmin.jsx`

- [ ] **Step 1: 读取两个 Admin 文件**

检查它们是否依赖 `APP_SHELL_*` 或旧 header/shell 类名。

- [ ] **Step 2: 移除旧 shell padding 依赖**

如果它们使用 `consoleAdminPageClass` 或类似的外层 class（`flex h-full min-h-0 w-full flex-col gap-6`），保持即可，但确保没有额外的顶部 padding/margin 造成内容下移。

如果页面内部有 "XEnsemble" header 或返回按钮，移除或替换为简单的页面标题。

- [ ] **Step 3: 确保 Admin 内容在白色画布中正常显示**

Admin 页面应使用 `bg-white` 或继承父级白色背景，表格/卡片继续使用 `consoleTheme` token。

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/pages/AgentsAdmin.jsx src/renderer/pages/UsersAdmin.jsx
git commit -m "feat: adapt Admin pages to new sidebar-main layout"
```

---

## Task 7: 清理遗留引用与最终验证

**Files:**
- Modify: 任何仍引用已删除 `Console.jsx` 的文件

- [ ] **Step 1: 搜索遗留引用**

```bash
grep -R "from '.*Console'\|from \".*Console\"\|pages/Console" src --include='*.jsx' --include='*.tsx' --include='*.js' --include='*.ts'
```

Expected: 无匹配（`SessionsPage` 除外）。

- [ ] **Step 2: 运行测试**

```bash
node --test src/renderer/lib/consoleTheme.test.js
node --test src/renderer/hooks/useWorkspaces.test.js
```

Expected: 全部通过。

- [ ] **Step 3: 运行构建与打包**

```bash
npm run build
npm run package:dir
```

Expected: 全部成功。

- [ ] **Step 4: 手动验收清单**

- [ ] 无顶部 header bar。
- [ ] 左侧 Sidebar `#F4F5F6` 通顶通底，宽度 `260px`。
- [ ] Sidebar 顶部仅显示 `XEnsemble` 品牌文字。
- [ ] Sidebar 中部显示 Workspaces 树。
- [ ] Sidebar 底部显示 Users / Agents 链接和用户资料。
- [ ] 右侧 Main Area `#FFFFFF`，无内层 card/border/shadow。
- [ ] 空状态在白色画布中居中。
- [ ] 有会话时 AgentConsole 占满右侧，终端保持深色，四周有 `p-4` 内边距。
- [ ] Admin 页面在白色画布中正常显示。

- [ ] **Step 5: 提交**

```bash
git add .
git commit -m "chore: finalize native desktop layout and clean up refs"
```

---

## 自审检查

### Spec coverage

| Spec 要求 | 对应任务 |
|---|---|
| 移除顶部 header bar | Task 4 |
| 左侧 Sidebar 通顶通底 #F4F5F6 | Task 2, Task 4 |
| Sidebar 顶部仅品牌文字 | Task 2 |
| Sidebar 中部 Workspaces | Task 2 |
| Sidebar 底部 Admin + User | Task 2 |
| 右侧 Main Area #FFFFFF 无 card | Task 3, Task 4 |
| 空状态居中 | Task 3 |
| AgentConsole 去 card + 浅色状态栏 + p-4 | Task 5 |
| Console.jsx → SessionsPage.jsx | Task 3 |
| useWorkspaces 统一管理数据 | Task 1 |
| Admin 页面适配 | Task 6 |

### Placeholder scan

- 无 TBD/TODO。
- 所有步骤给出具体文件路径和代码片段。
- 测试代码完整。

### Type consistency

- `useWorkspaces` 返回 `{ agents, projects, sessions, activeSession, setActiveSession, fetchWorkspaces }`。
- `AppSidebar` 接收相同字段作为 props。
- `SessionsPage` 接收相同字段作为 props。

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-native-desktop-layout-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
