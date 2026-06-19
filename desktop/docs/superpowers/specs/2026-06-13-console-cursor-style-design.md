# Console 页面 Cursor 风格视觉重构设计文档

## 1. 背景与目标

XEnsembleDesktop 的 Console 页面目前复用了 XEnsemble Web 端的浅色风格，视觉上与桌面 IDE 的紧凑工作区仍有差距。用户希望将其改造为类似 Cursor IDE 的紧凑布局：

- 去掉顶部应用菜单栏。
- 左、中、右三个区域通过颜色区分。
- 整体更紧凑，减少多余间距和装饰。
- 左侧工作区卡片保留，但删除顶部大的 “New workspace” 按钮。
- 工作区卡片标题栏右侧的 `+` 按钮使用主题强调色。
- 页面宽度小于 1024px 时，左侧工作区自动折叠为窄条，而不是移动到终端上方。

同时，用户进一步明确了整体视觉风格体系：高级极简主义、低对比低饱和的 Morandi 浅色模式、内容优先、弱化边框、扁平化深度。

## 2. 设计哲学

- **高级极简主义（Premium Minimalism）**：界面宁静、无干扰，像现代数字杂志一样温润，又像高端开发工具一样精密。
- **内容优先（Content-First）**：终端和文件内容是最突出的元素，UI 装饰极度收敛。
- **低对比、低饱和**：长时间使用不疲劳，避免纯黑和刺眼高饱和色。
- **弱化边框**：不用深色实线分割线，靠背景色层级和极淡发丝边框区分区域。
- **扁平化深度**：避免沉重投影或强烈渐变，如需表现深度，仅使用单层极高模糊度、高弥散的自然环境光阴影。

## 3. 色彩系统（Morandi 浅色模式）

所有颜色通过 `src/renderer/lib/consoleTheme.js` 以设计令牌形式导出，供 Console 页面统一使用。当前 `consoleTokens.js` 中已有的 `consoleToolPageClass` 和 `consoleDialogPanelClass` 也需要同步迁移为浅色主题。

| 令牌 | Tailwind 值 | 用途 |
|---|---|---|
| `bgCanvas` | `bg-[#FFFFFF]` | 主活动画布，如左侧工作区面板 |
| `bgContainer` | `bg-[#F7F8F9]` | 容器背景，如中间终端面板 |
| `bgSecondary` | `bg-[#F4F5F6]` | 次级/辅助背景，如右侧文件面板 |
| `textPrimary` | `text-[#202124]` | 主要文本，深炭灰 |
| `textSecondary` | `text-[#5F6368]` | 次要文本、元数据、标签 |
| `borderHairline` | `border-[#E8EAED]` | 发丝般极淡边框 |
| `borderSubtle` | `border-[#DADCE0]` | 稍明显的分隔边框 |
| `accentBlue` | `text-[#5B8DB8] hover:text-[#4A7298]` | 主操作强调色（如不饱和蓝） |
| `accentGreen` | `text-[#4A7C59]` / `bg-[#E8F5E9]` | 运行中状态 |
| `accentRed` | `text-[#C06C5D] hover:text-[#A35A4D]` | 删除/危险操作 |

> 注：当前实现阶段优先使用 Tailwind 内联颜色值以快速验证。后续若颜色体系扩展，可迁移至 Tailwind 配置或 CSS 变量。

### 3.1 现有令牌迁移

`consoleTokens.js` 中当前存在以下导出，需一并迁移到 `consoleTheme.js` 并按浅色主题重新赋值：

| 令牌 | 当前值 | 迁移后目标 |
|---|---|---|
| `consoleToolPageClass` | 深色 `bg-zinc-950 text-zinc-100` | 浅色 `bg-[#F7F8F9] text-[#202124]` |
| `consoleDialogPanelClass` | 深色背景 | 浅色 `bg-[#FFFFFF] border border-[#E8EAED]` |

所有引用这两个令牌的组件（Console 页面及弹窗）都需要重新验证浅色下的可读性。

## 4. 布局架构

屏幕沿用三栏结构，但按以下理念重新映射：

### 4.1 左栏：固定导航侧边栏

- 宽度：展开时 `w-72` 或 `w-80`，折叠时 `w-12`。
- 背景：`bg-[#FFFFFF]`。
- 分隔：极淡右边框 `border-[#E8EAED]`，或完全依靠与中栏的背景色差区分。
- 圆角：容器级 `rounded-2xl`（16px）。
- 内容：工作区列表、Pinned/Recently 分组、每个工作区下的会话行。
- 标题栏：紧凑，图标尺寸 14px，`+` 按钮使用 `accentBlue`。
- 删除顶部大的 “New workspace” 按钮，仅保留标题栏右侧的 `+`。

### 4.2 中栏：动态文档视口

- 背景：`bg-[#F7F8F9]`。
- 圆角：容器级 `rounded-2xl`（16px）到 `rounded-3xl`（24px）。
- 留白：内部保持呼吸感，但标题栏和工具栏更紧凑。
- 无活动会话时，空状态提示使用 `textSecondary`，图标使用极淡灰。

### 4.3 右栏：停靠式文件面板

- 宽度：`w-72`。
- 背景：`bg-[#F4F5F6]`，与左栏、中栏形成三层色阶。
- 圆角：容器级 `rounded-2xl`（16px）。
- 标题栏：紧凑，刷新按钮使用 `accentBlue`。
- 文件树选中态使用不饱和粉彩背景，而非深色边框。

## 5. 字体排印

- 标准界面文本：系统无衬线字体（Tailwind 默认 `font-sans`）。
- 技术标签、路径、哈希值：等宽字体 `font-mono`。
- 依靠字重（`font-semibold` vs `font-normal`）和颜色/不透明度区分层级，避免剧烈字号变化。
- 主要字号：界面元素 `text-xs`，标题 `text-xs uppercase tracking-wider`。

## 6. 圆角与间距

- 元素级（按钮、列表选中态）：`rounded-md`（6px）到 `rounded-lg`（8px）。
- 容器级（面板、核心焦点）：`rounded-2xl`（16px）到 `rounded-3xl`（24px）。
- 紧凑但留有呼吸感：
  - 面板内 padding：`p-3`。
  - 标题栏：`px-3 py-2`。
  - 列表行：`px-1.5 py-1`。
  - 图标尺寸：操作图标 14px，大图标 16px。

## 7. 微交互

- 所有状态变化使用平滑过渡：`transition-colors duration-150 ease-in-out`。
- 悬停状态使用背景色变化（如 `hover:bg-[#F4F5F6]`），不添加实线边框。
- 按钮聚焦环使用淡色 outline，避免高对比边框。
- 危险操作悬停使用 `accentRed` 配淡红背景 `hover:bg-[#FDECEA]`。

## 8. 响应式行为

- 窗口宽度 ≥ 1024px：左侧工作区面板正常展开。
- 窗口宽度 < 1024px：左侧自动折叠为 `w-12` 的窄条，只显示折叠/展开按钮和运行计数徽章；点击展开按钮可临时展开或恢复。
- 右侧文件面板在 `workspaceOpen` 为 true 且存在活动会话时显示；在小屏下保持自身宽度，可通过 `workspaceOpen` 开关控制。

## 9. 实现方案

采用 **方案 B：设计令牌（consoleTheme.js）**。

- 将 `src/renderer/lib/consoleTokens.js` 重命名为 `src/renderer/lib/consoleTheme.js`。
- 在 `consoleTheme.js` 中定义上述所有颜色、间距、文本、圆角、过渡令牌。
- 在 `src/renderer/pages/Console.jsx` 中统一引用这些令牌，替换当前分散的 Tailwind 类名。
- 搜索项目中所有引用 `consoleTokens.js` 的位置，统一改为 `consoleTheme.js`。
- 同步更新页面中的弹窗（新建会话、配置 API keys、删除确认、错误提示）和文件预览弹窗，使其与新的浅色莫兰迪风格一致。

## 10. 排除项

- 不涉及功能逻辑变更（登录、会话生命周期、API 调用、WebSocket 终端）。
- 不引入新的字体文件，使用系统字体栈。
- 不做深色模式切换，本次仅优化浅色模式。
- 不做大范围的组件拆分，保持 `Console.jsx` 为主体实现文件。

## 11. 验收标准

- [ ] 顶部无应用菜单栏。
- [ ] 左/中/右面板颜色遵循 #FFFFFF / #F7F8F9 / #F4F5F6 三层色阶。
- [ ] 不使用深色实线分割线，分隔依靠背景色差异或 #E8EAED / #DADCE0 极淡边框。
- [ ] 左侧顶部大的 “New workspace” 按钮已删除。
- [ ] 工作区卡片标题栏右侧 `+` 按钮使用不饱和蓝色强调色 `accentBlue`。
- [ ] 页面宽度 < 1024px 时，左侧工作区面板自动折叠为窄条。
- [ ] 弹窗、文件预览、确认对话框与新的浅色莫兰迪风格一致。
- [ ] 所有相关 import 从 `consoleTokens.js` 迁移到 `consoleTheme.js`，无遗留引用。
