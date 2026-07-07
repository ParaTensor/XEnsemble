# AI Agent 协作规则

## 系统架构（强制对齐）

执行面迁移到独立云环境、Runtime 抽象、Workspace 存储、Preview/Deployment 服务等所有后端实现，必须以 **`docs/Architecture.md`** 为唯一规范。开发或评审相关代码前须阅读该文档；任何直接依赖本机 FS/PTY 的假设仅限 Local 实现内部。

## 前端 UI

`web/` 的布局、组件与交互以根目录 **`DESIGN.md`** 为唯一规范入口（Console 面、对齐 ParaRouter `DESIGN.md`）；完整细则见 **`docs/Designs.md`**。实现或评审前端前须阅读上述文档；**勿在本文重复 UI 细则。**

**下拉框（强制）**：禁止使用原生 HTML `<select>` / `<option>`。单选用 `web/src/components/SelectMenu.jsx`，多选用 `web/src/components/MultiSelectMenu.jsx`；样式与交互见 `DESIGN.md` 与 `docs/Designs.md`。

**弹窗首项聚焦（强制）**：打开含文本输入的 Dialog / Modal 时，主输入框须在打开后自动获得焦点（`autoFocus` 或等效 `ref` + `focus()`），用户无需再用鼠标点击即可输入。新建 Workspace、新建 Session、配置表单等场景均适用。

**异步操作反馈（强制）**：会触发网络请求或耗时操作的按钮、表单提交须立即进入 loading 态：`disabled` 防重复提交，文案切换为进行中（如「Signing in…」）或 spinner（图标按钮用同尺寸 `Loader2` 原位替换），请求结束后再恢复。细则见 `DESIGN.md` § 异步与加载。

**按钮聚焦样式（强制）**：所有 `<button>` 点击或键盘聚焦时**不得**出现外框 / focus ring。统一使用 `consoleTheme.js` 的 `consoleButtonFocusClass`，或 `buttonStyles.js` 的 `buttonBase`（已内置无 ring）；禁止在按钮上单独加 `focus:ring-*`。文本输入框、下拉菜单等表单控件可保留聚焦边框以提示输入位置。

Agent 领域说明与架构对齐要求见 **`docs/agents.md`**（Gateway 反代见 **`docs/LlmProxy.md`**；内含对 Architecture.md 的引用）。

用户、角色、配额与运维 CLI 见 **`docs/UserManagement.md`**。Desktop / 原生客户端 HTTP+WS 接入见 **`docs/ApiClient.md`**。
