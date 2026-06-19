# Console 页面 Cursor 风格视觉重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 XEnsembleDesktop 的 Console 页面改造为 Cursor IDE 风格的紧凑浅色布局，同时把样式令牌从 `consoleTokens.js` 重命名为 `consoleTheme.js`，并在全项目应用新的 Morandi 浅色设计系统。

**Architecture:** 所有共享样式集中到 `src/renderer/lib/consoleTheme.js`；`Console.jsx` 通过导入主题令牌替换分散的 Tailwind 类名；其他已引用 `consoleTokens.js` 的组件同步改 import，必要时微调以匹配新主题；验证通过 Node 内置测试 + `npm run build`。

**Tech Stack:** React 18, Tailwind CSS 3, Electron 39, electron-vite 3, Node 20 test runner.

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/renderer/lib/consoleTheme.js` | 由 `consoleTokens.js` 重命名而来；存放所有 Console/Admin 页面的共享样式令牌。 |
| `src/renderer/lib/consoleTheme.test.js` | 使用 Node 20 `node:test` 验证关键令牌导出。 |
| `src/renderer/pages/Console.jsx` | Console 页面主体；应用新主题令牌和紧凑布局。 |
| `src/renderer/components/ConsoleDialog.jsx` | 弹窗外壳；同步更新为浅色主题。 |
| `src/renderer/components/*.{jsx,tsx}` 等 | 所有引用 `consoleTokens.js` 的组件，改 import 并视情况微调。 |

---

## Task 1: 重命名 `consoleTokens.js` → `consoleTheme.js` 并更新全局 import

**Files:**
- Rename: `src/renderer/lib/consoleTokens.js` → `src/renderer/lib/consoleTheme.js`
- Modify: 所有 import 自 `../lib/consoleTokens` 或 `./lib/consoleTokens` 的文件

- [ ] **Step 1: 重命名文件**

```bash
git mv src/renderer/lib/consoleTokens.js src/renderer/lib/consoleTheme.js
```

- [ ] **Step 2: 替换所有 import 路径**

搜索并替换项目中所有 `from '../lib/consoleTokens'`、`from '../../lib/consoleTokens'`、`from './lib/consoleTokens'` 为对应层级的 `consoleTheme`。

命令示例：

```bash
find src -type f \( -name '*.jsx' -o -name '*.tsx' -o -name '*.js' -o -name '*.ts' \) -exec grep -l "consoleTokens" {} \;
```

逐文件将 import 源从 `consoleTokens` 改为 `consoleTheme`，保持导出名不变。

- [ ] **Step 3: 验证无遗留引用**

```bash
if grep -R "consoleTokens" src --include='*.jsx' --include='*.tsx' --include='*.js' --include='*.ts'; then echo 'FOUND OLD IMPORTS'; exit 1; else echo 'NO OLD IMPORTS'; fi
```

Expected: `NO OLD IMPORTS`

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 无 import 相关错误。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/consoleTheme.js src/renderer/lib/consoleTokens.js $(git diff --name-only)
git commit -m "refactor: rename consoleTokens.js to consoleTheme.js"
```

---

## Task 2: 扩展 `consoleTheme.js` 并新增 Morandi 浅色令牌

**Files:**
- Modify: `src/renderer/lib/consoleTheme.js`
- Create: `src/renderer/lib/consoleTheme.test.js`

- [ ] **Step 1: 写失败测试**

```js
// src/renderer/lib/consoleTheme.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  consoleToolPageClass,
  consoleDialogPanelClass,
  bgCanvas,
  bgContainer,
  bgSecondary,
  textPrimary,
  textSecondary,
  borderHairline,
  borderSubtle,
  accentBlue,
  accentRed,
} from './consoleTheme.js';

describe('consoleTheme tokens', () => {
  it('exports page background as light Morandi', () => {
    assert.match(consoleToolPageClass, /bg-\[#F7F8F9\]/);
    assert.match(consoleToolPageClass, /text-\[#202124\]/);
  });

  it('exports dialog panel as light', () => {
    assert.match(consoleDialogPanelClass, /bg-\[#FFFFFF\]/);
    assert.match(consoleDialogPanelClass, /border-\[#E8EAED\]/);
  });

  it('exports new panel background tokens', () => {
    assert.strictEqual(bgCanvas, 'bg-[#FFFFFF]');
    assert.strictEqual(bgContainer, 'bg-[#F7F8F9]');
    assert.strictEqual(bgSecondary, 'bg-[#F4F5F6]');
  });

  it('exports new text tokens', () => {
    assert.strictEqual(textPrimary, 'text-[#202124]');
    assert.strictEqual(textSecondary, 'text-[#5F6368]');
  });

  it('exports new border tokens', () => {
    assert.strictEqual(borderHairline, 'border-[#E8EAED]');
    assert.strictEqual(borderSubtle, 'border-[#DADCE0]');
  });

  it('exports accent tokens', () => {
    assert.match(accentBlue, /#5B8DB8/);
    assert.match(accentRed, /#C06C5D/);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
node --test src/renderer/lib/consoleTheme.test.js
```

Expected: FAIL — 新令牌未定义或旧值不匹配。

- [ ] **Step 3: 更新 `consoleTheme.js`**

保留现有所有导出名称（避免破坏其他组件），在文件顶部新增 Morandi 令牌，并修改 `consoleToolPageClass` 和 `consoleDialogPanelClass` 为浅色：

```js
/** Console theme tokens — Morandi light mode, Cursor-like compact IDE surface. */

// Panel backgrounds
export const bgCanvas = 'bg-[#FFFFFF]';
export const bgContainer = 'bg-[#F7F8F9]';
export const bgSecondary = 'bg-[#F4F5F6]';

// Text
export const textPrimary = 'text-[#202124]';
export const textSecondary = 'text-[#5F6368]';

// Borders
export const borderHairline = 'border-[#E8EAED]';
export const borderSubtle = 'border-[#DADCE0]';

// Accents (Morandi pastel)
export const accentBlue = 'text-[#5B8DB8] hover:text-[#4A7298]';
export const accentBlueBg = 'bg-[#5B8DB8] hover:bg-[#4A7298]';
export const accentGreen = 'text-[#4A7C59]';
export const accentGreenBg = 'bg-[#E8F5E9] text-[#4A7C59]';
export const accentRed = 'text-[#C06C5D] hover:text-[#A35A4D]';
export const accentRedBg = 'bg-[#FDECEA] hover:bg-[#FADBD8]';

// Compact spacing / sizing
export const panelPadding = 'p-3';
export const headerPadding = 'px-3 py-2';
export const compactRadius = 'rounded-lg';     // 8px
export const containerRadius = 'rounded-2xl';  // 16px
export const transitionBase = 'transition-colors duration-150 ease-in-out';

// Existing tokens (kept for backward compatibility, values migrated to light theme)
export const consoleBackdropClass = 'fixed inset-0 bg-black/50 transition-opacity';

export const consoleDialogPanelClass =
  `relative ${bgCanvas} ${borderHairline} shadow-sm rounded-lg ${textPrimary} text-left flex flex-col overflow-hidden`;

export const consoleDialogSmClass =
  `${consoleDialogPanelClass} w-full max-w-sm max-w-[calc(100vw-2rem)]`;

export const consoleDialogMdClass =
  `${consoleDialogPanelClass} w-[480px] max-w-[calc(100vw-2rem)]`;

export const consoleDialogLgClass =
  `${consoleDialogPanelClass} w-[560px] max-w-[calc(100vw-2rem)]`;

export const consoleStructuredDialogPanelClass =
  `${consoleDialogMdClass} flex flex-col max-h-[90vh] overflow-hidden p-0`;

export const consoleStructuredDialogHeaderClass =
  `px-4 py-3 ${borderHairline} border-b shrink-0 ${bgCanvas}`;

export const consoleStructuredDialogBodyClass =
  'flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4 console-scroll-hidden';

export const consoleStructuredDialogFooterClass =
  `${borderHairline} border-t px-4 py-3 bg-[#FAFBFC] flex justify-end gap-2 shrink-0`;

export const consoleDialogAdminFormPanelClass =
  `relative ${bgCanvas} ${borderHairline} shadow-sm rounded-lg text-left w-[480px] max-w-[calc(100vw-2rem)]`;

export const consoleInputClass =
  `w-full ${bgCanvas} ${borderSubtle} rounded-md px-3 py-2 text-sm ${textPrimary} placeholder:text-[#9AA0A6] focus:outline-none focus:border-[#5B8DB8] focus:ring-1 focus:ring-[#5B8DB8] ${transitionBase}`;

export const consoleToolbarControlClass = 'h-9 min-h-9 text-sm';

export const consoleToolbarInputClass = `${consoleInputClass} ${consoleToolbarControlClass} py-1.5`;

export const consolePageStackClass = 'space-y-6';

export const consolePageTitleClass = `text-2xl font-bold tracking-tight ${textPrimary}`;

export const consoleAdminPageClass = 'flex h-full min-h-0 w-full flex-col gap-6';

export const consoleToolPageClass =
  `flex h-full min-h-0 w-full flex-col ${bgContainer} ${textPrimary}`;

export const consoleAdminTableScrollClass = 'min-h-0 flex-1 overflow-auto console-scroll-hidden';

export const consoleTableShellClass =
  `${bgCanvas} ${borderHairline} rounded-lg overflow-hidden shadow-sm`;

export const consoleAdminTableShellClass =
  `${consoleTableShellClass} flex min-h-0 flex-1 flex-col`;

export const consoleTableHeadRowClass = `bg-[#FAFBFC] ${borderHairline} border-b`;

export const consoleTableBodyDivideClass = `divide-y divide-[#E8EAED]`;

export const consoleTableBodyRowClass = 'hover:bg-[#FAFBFC] transition-colors';

export const consoleTableHeadCellClass =
  `px-4 py-2.5 text-xs font-semibold ${textSecondary} uppercase tracking-wider`;

export const consoleTableBodyCellClass = `px-4 py-3 text-sm text-[#3C4043]`;

export const consoleTableHeadCellDenseClass =
  `px-3 py-2.5 text-xs font-semibold ${textSecondary} uppercase tracking-wider`;

export const consoleTableBodyCellDenseClass = `px-3 py-3 text-sm text-[#3C4043]`;

export const consoleTableSectionHeaderClass =
  `px-4 py-3 ${borderHairline} border-b flex items-center justify-between`;

export const consoleCardClass = `${bgCanvas} ${borderHairline} rounded-lg shadow-sm`;

export const consoleFormLabelClass =
  `block text-xs font-semibold uppercase tracking-wider ${textSecondary}`;

export const consoleSectionLabelClass = consoleFormLabelClass;

export const consoleDropdownPanelClass =
  `rounded-lg ${borderHairline} ${bgCanvas} shadow-sm`;

export const consoleFilterToolbarClass =
  `${bgCanvas} ${borderHairline} rounded-lg p-4 sm:p-5 shadow-sm space-y-4`;

export const consoleStatValueClass = `text-2xl font-bold tracking-tight ${textPrimary}`;

export const consoleEmptyStateClass =
  `flex flex-col items-center justify-center rounded-lg border border-dashed ${borderHairline} bg-[#FAFBFC]`;

export const consoleNavActiveClass = 'bg-[#E8EAED] text-[#202124]';

export const consoleNavIdleClass = `text-[#5F6368] hover:bg-[#F4F5F6] hover:text-[#202124]`;

export const consoleSettingsTabActiveClass =
  'bg-[#202124] text-white shadow-lg shadow-black/10';

export const consoleSettingsTabIdleClass =
  `text-[#5F6368] hover:bg-[#F4F5F6] hover:text-[#202124]`;

export const consoleSettingsPanelScrollClass =
  `flex-1 min-h-0 min-w-0 overflow-y-auto console-scroll-hidden ${bgCanvas} px-5 py-4`;

export const consoleStatusBadgeClass =
  'inline-flex items-center gap-1 min-w-[6.5rem] h-4 text-xs';

export const consoleStatusIconSlotClass =
  'inline-flex w-3 h-3 shrink-0 items-center justify-center';

export const consoleMenuDropdownZClass = 'z-[110]';

export const consoleIconButtonClass =
  `inline-flex items-center justify-center rounded-md p-1.5 text-[#5F6368] hover:bg-[#F4F5F6] hover:text-[#202124] disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-[#5B8DB8] focus:ring-offset-1 ${transitionBase}`;

export const consoleIconButtonDangerClass =
  `inline-flex items-center justify-center rounded-md p-1.5 text-[#C06C5D] hover:bg-[#FDECEA] hover:text-[#A35A4D] disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:ring-2 focus:ring-[#C06C5D] focus:ring-offset-1 ${transitionBase}`;
```

- [ ] **Step 4: 运行测试验证通过**

```bash
node --test src/renderer/lib/consoleTheme.test.js
```

Expected: PASS

- [ ] **Step 5: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/consoleTheme.js src/renderer/lib/consoleTheme.test.js
git commit -m "feat: add Morandi light theme tokens to consoleTheme.js"
```

---

## Task 3: 更新 `Console.jsx` 主布局三栏面板

**Files:**
- Modify: `src/renderer/pages/Console.jsx`

- [ ] **Step 1: 导入新令牌**

在 `Console.jsx` 顶部 import 中新增：

```js
import {
  consoleDialogPanelClass,
  consoleToolPageClass,
  bgCanvas,
  bgContainer,
  bgSecondary,
  textPrimary,
  textSecondary,
  borderHairline,
  borderSubtle,
  accentBlue,
  accentRed,
  accentGreen,
  panelPadding,
  headerPadding,
  compactRadius,
  containerRadius,
  transitionBase,
} from '../lib/consoleTheme.js';
```

- [ ] **Step 2: 更新主布局容器**

将主布局 div 从：

```jsx
<div className={consoleToolPageClass}>
```

保持不变（因为 `consoleToolPageClass` 已更新为浅色）。

将三栏容器从 `gap-4` 改为 `gap-3`：

```jsx
<div className="flex min-h-0 flex-1 flex-row gap-3 items-stretch">
```

- [ ] **Step 3: 更新左侧面板**

将左侧面板外层改为：

```jsx
<div className={`flex shrink-0 flex-col min-h-0 transition-all duration-200 ${sidebarCollapsed ? 'w-12' : 'w-72'}`}>
  <div className={`${bgCanvas} ${borderHairline} ${containerRadius} shadow-sm flex flex-col flex-1 min-h-0 overflow-hidden`}>
    <div className={`flex items-center gap-2 ${borderHairline} border-b shrink-0 ${sidebarCollapsed ? 'justify-center p-2' : `justify-between ${headerPadding}`}`}>
      ...
    </div>
    <div className={`flex-1 min-h-0 overflow-auto ${panelPadding} console-scroll-hidden ${sidebarCollapsed ? 'hidden' : ''}`}>
      ...
    </div>
  </div>
</div>
```

- [ ] **Step 4: 更新工作区标题栏 `+` 按钮为主题蓝色**

标题栏右侧的 `New workspace` 图标按钮改为 `accentBlue`：

```jsx
<button
  type="button"
  title="New workspace"
  disabled={isLoading || agents.length === 0}
  onClick={() => openLaunchModal('workspace')}
  className={`p-1 ${accentBlue} rounded-md hover:bg-[#F4F5F6] disabled:opacity-50 ${transitionBase}`}
>
  <FolderPlus className="w-3.5 h-3.5" />
</button>
```

并删除左侧顶部任何独立的大 “New workspace” 按钮（当前代码中不存在独立大按钮，标题栏 `+` 保留）。

- [ ] **Step 5: 更新中间终端面板**

将中间面板从当前 `bg-white`/`border-zinc-200` 改为：

```jsx
<div className="flex min-h-0 min-w-0 flex-1 flex-col">
  <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${bgContainer} ${borderHairline} ${containerRadius}`}>
    ...
  </div>
</div>
```

无活动会话时的空状态面板也使用 `bgContainer`/`borderHairline`：`consoleEmptyStateClass` 已更新，但可直接使用：

```jsx
<div className={`${consoleEmptyStateClass} p-8 text-center ${textSecondary}`}>
  ...
</div>
```

- [ ] **Step 6: 更新右侧面板**

将右侧面板改为：

```jsx
<div className={`flex w-full shrink-0 flex-col min-h-0 overflow-hidden ${bgSecondary} ${borderHairline} ${containerRadius} shadow-sm lg:w-72 lg:min-h-0`}>
  <div className={`flex items-center justify-between ${borderHairline} border-b px-3 py-2 shrink-0`}>
    ...
    <button className={`p-1.5 ${accentBlue} rounded-md hover:bg-[#FFFFFF] ${transitionBase}`}>...</button>
  </div>
  <div className={`flex-1 overflow-auto ${panelPadding} min-h-0`}>...</div>
</div>
```

- [ ] **Step 7: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/pages/Console.jsx
git commit -m "feat: apply Morandi theme to Console main layout panels"
```

---

## Task 4: 更新 `Console.jsx` 工作区列表和会话行

**Files:**
- Modify: `src/renderer/pages/Console.jsx`

- [ ] **Step 1: 更新工作区行和会话行颜色**

将 `renderSessionRow` 中的活动/悬停背景从 `bg-zinc-800` 改为 `bg-[#E8EAED]` 或 `hover:bg-[#F4F5F6]`；文本从 `text-zinc-300` 改为 `text-[#3C4043]`；运行中指示点保持绿色但使用不饱和绿 `#4A7C59`。

示例修改：

```jsx
<div
  key={s.id}
  className={`group/session relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm transition-colors ${
    isActive ? 'bg-[#E8EAED]' : 'hover:bg-[#F4F5F6]'
  } ${!isLive ? 'opacity-70' : ''}`}
>
  <span className={`shrink-0 w-1 h-1 rounded-full ${isLive ? 'bg-[#4A7C59]' : 'bg-[#9AA0A6]'}`} />
  <button className={`flex-1 min-w-0 text-left text-xs text-[#3C4043] disabled:opacity-50`}>...</button>
  ...
</div>
```

- [ ] **Step 2: 更新工作区标题行**

将工作区标题行的文件夹图标颜色从 `text-zinc-500` 改为 `text-[#9AA0A6]`，文本改为 `text-sm text-[#202124]`，运行计数徽章改为 `text-[#4A7C59]`。

操作按钮使用 `consoleIconButtonClass` 和 `consoleIconButtonDangerClass`（如果已导入），或直接使用对应颜色类。

- [ ] **Step 3: 更新 “No sessions” 和 “No workspaces yet” 提示**

改为 `textSecondary`：

```jsx
<p className={`text-sm ${textSecondary} px-2 py-1`}>No workspaces yet...</p>
```

- [ ] **Step 4: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/Console.jsx
git commit -m "feat: style workspace list and session rows for Morandi theme"
```

---

## Task 5: 更新 `Console.jsx` 弹窗为浅色 Morandi 风格

**Files:**
- Modify: `src/renderer/pages/Console.jsx`

- [ ] **Step 1: 文件预览弹窗**

将文件预览弹窗的头部、内容区改为浅色：

```jsx
<div className={`flex items-center justify-between ${borderHairline} border-b bg-[#FAFBFC] px-4 py-3 shrink-0`}>
  <div className="flex min-w-0 items-center gap-2">
    <FileText className="w-4 h-4 shrink-0 text-[#9AA0A6]" />
    <span className={`truncate text-sm font-semibold ${textPrimary}`}>{viewingFile.name}</span>
    <span className="truncate text-xs font-mono text-[#9AA0A6]">{viewingFile.path}</span>
  </div>
  <button className={`shrink-0 rounded-md p-1.5 text-[#5F6368] hover:bg-[#F4F5F6] hover:text-[#202124] ${transitionBase}`}>...</button>
</div>
<div className="min-h-0 flex-1 overflow-auto p-4 bg-[#FAFBFC] text-sm font-mono text-[#3C4043] whitespace-pre">
  {fileContent}
</div>
```

- [ ] **Step 2: 删除工作区确认弹窗**

将 `deleteConfirmWorkspace` 弹窗的 `panelClassName` 改为 `consoleDialogPanelClass` 或直接使用 `${bgCanvas} ${borderHairline} rounded-lg shadow-lg w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden`；内部标题、正文、按钮颜色同步改为浅色主题。

示例：

```jsx
<ConsoleAnchoredDialog
  onClose={() => setDeleteConfirmWorkspace(null)}
  anchorRect={deleteConfirmWorkspace.anchorRect}
  panelClassName={`${consoleDialogPanelClass} w-72 max-w-[calc(100vw-1.5rem)]`}
>
  <div className={`${consoleStructuredDialogHeaderClass} flex items-center gap-3`}>
    <Trash2 className="w-5 h-5 shrink-0 text-[#9AA0A6]" />
    <h3 className={`font-semibold text-sm ${textPrimary}`}>...</h3>
  </div>
  <div className={`p-4 text-sm ${textSecondary}`}>...</div>
  <div className={`${consoleStructuredDialogFooterClass}`}>
    <button className={`h-9 px-4 ${bgCanvas} ${borderHairline} ${textPrimary} rounded-md text-sm font-medium hover:bg-[#F4F5F6] ${transitionBase}`}>Cancel</button>
    <button className={`h-9 px-4 bg-[#C06C5D] text-white rounded-md text-sm font-medium hover:bg-[#A35A4D] disabled:opacity-50 ${transitionBase}`}>...</button>
  </div>
</ConsoleAnchoredDialog>
```

- [ ] **Step 3: 删除会话确认弹窗**

与删除工作区弹窗类似，应用 `consoleDialogPanelClass`、`consoleStructuredDialogHeaderClass`、`consoleStructuredDialogFooterClass` 和新文本颜色。

- [ ] **Step 4: 错误提示弹窗**

将错误弹窗头部背景从 `bg-red-50 text-red-600` 改为浅色警告风格：`text-[#C06C5D]` 配 `bg-[#FDECEA]`；正文使用 `textSecondary`；按钮使用主题色。

- [ ] **Step 5: 新建会话 / 配置 API keys 弹窗**

将 `showNewInstanceModal` 和 `showConfigModal` 的外层面板改为 `consoleDialogPanelClass`；头部改为 `consoleStructuredDialogHeaderClass`；底部改为 `consoleStructuredDialogFooterClass`；错误提示背景改为 `bg-[#FDECEA] border-[#FADBD8] text-[#C06C5D]`；输入框使用 `consoleInputClass`；主按钮改为 `bg-[#202124] hover:bg-[#3C4043]` 或 `accentBlueBg`。

- [ ] **Step 6: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/Console.jsx
git commit -m "feat: restyle Console modals for Morandi light theme"
```

---

## Task 6: 更新 `ConsoleDialog.jsx` 以匹配新主题

**Files:**
- Modify: `src/renderer/components/ConsoleDialog.jsx`

- [ ] **Step 1: 读取当前 `ConsoleDialog.jsx`**

确认当前对话框外壳和关闭按钮样式，用新颜色替换：

```jsx
<button
  onClick={onClose}
  className={`rounded-md p-1.5 text-[#5F6368] hover:bg-[#F4F5F6] hover:text-[#202124] ${transitionBase}`}
>
  <X className="w-4 h-4" />
</button>
```

- [ ] **Step 2: 确保遮罩和定位层与浅色主题协调**

遮罩 `consoleBackdropClass` 保持 `bg-black/50` 即可；定位容器无需深色主题特殊处理。

- [ ] **Step 3: 构建验证**

```bash
npm run build
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ConsoleDialog.jsx
git commit -m "feat: update ConsoleDialog shell for Morandi light theme"
```

---

## Task 7: 最终全量构建与手动验收

**Files:**
- Verify: 所有已修改文件

- [ ] **Step 1: 全量构建**

```bash
npm run build
```

Expected: `electron-vite build` 成功完成，无 TypeScript/React 错误。

- [ ] **Step 2: 打包验证**

```bash
npm run package:dir
```

Expected: 成功生成产物目录（macOS 下为 `dist/mac*/XEnsembleDesktop.app`），无打包错误。

- [ ] **Step 3: 启动开发模式进行手动验收**

```bash
npm run dev
```

手动对照验收标准检查：

- [ ] 顶部无应用菜单栏。
- [ ] 左/中/右面板颜色为 #FFFFFF / #F7F8F9 / #F4F5F6。
- [ ] 无深色实线分割线。
- [ ] 左侧无大的 “New workspace” 按钮。
- [ ] 工作区标题栏右侧 `+` 按钮为不饱和蓝色。
- [ ] 窗口宽度 < 1024px 时左侧折叠为窄条。
- [ ] 弹窗、文件预览、删除确认与浅色 Morandi 风格一致。

- [ ] **Step 4: Commit（如需要修复则包含修复）**

```bash
git add .
git commit -m "feat: complete Console Cursor-style Morandi light theme"
```

---

## 自审检查

### Spec coverage

| Spec 要求 | 对应任务 |
|---|---|
| 去掉顶部应用菜单栏 | 已由前期实现完成；本计划不重复修改 |
| 左/中/右面板颜色区分 | Task 3 |
| 整体紧凑化 | Task 3, Task 4 |
| 删除左侧大 “New workspace” 按钮 | Task 3（确认并删除） |
| 标题栏 `+` 按钮主题蓝色 | Task 3 |
| 宽度 < 1024px 左侧折叠 | Task 3（保留现有逻辑，调整视觉） |
| Morandi 浅色色彩系统 | Task 2 |
| 弹窗与文件预览浅色化 | Task 5, Task 6 |
| consoleTokens → consoleTheme 重命名 | Task 1, Task 2 |

### Placeholder scan

- 无 TBD/TODO。
- 无 “add appropriate error handling” 等模糊步骤。
- 每个代码步骤均给出具体类名和值。
- 测试代码完整可运行。

### Type consistency

- `consoleTheme.js` 保留所有旧导出名称，仅修改值，import 方无需改导出名。
- 新增 Morandi 令牌命名一致：`bgCanvas`, `bgContainer`, `bgSecondary`, `textPrimary`, `textSecondary`, `borderHairline`, `borderSubtle`, `accentBlue`, `accentRed`, `accentGreen`。

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-console-cursor-style-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
