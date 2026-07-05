# AI Agent 协作规则

## 系统架构（强制对齐）

执行面迁移到独立云环境、Runtime 抽象、Workspace 存储、Preview/Deployment 服务等所有后端实现，必须以 **`docs/Architecture.md`** 为唯一规范。开发或评审相关代码前须阅读该文档；任何直接依赖本机 FS/PTY 的假设仅限 Local 实现内部。

## 前端 UI

`web/` 的布局、组件与交互以根目录 **`DESIGN.md`** 为唯一规范入口（Console 面、对齐 ParaRouter `DESIGN.md`）；完整细则见 **`docs/Designs.md`**。实现或评审前端前须阅读上述文档；**勿在本文重复 UI 细则。**

**下拉框（强制）**：禁止使用原生 HTML `<select>` / `<option>`。单选用 `web/src/components/SelectMenu.jsx`，多选用 `web/src/components/MultiSelectMenu.jsx`；样式与交互见 `DESIGN.md` 与 `docs/Designs.md`。

**弹窗首项聚焦（强制）**：打开含文本输入的 Dialog / Modal 时，主输入框须在打开后自动获得焦点（`autoFocus` 或等效 `ref` + `focus()`），用户无需再用鼠标点击即可输入。新建 Workspace、新建 Session、配置表单等场景均适用。

Agent 领域说明与架构对齐要求见 **`docs/agents.md`**（Gateway 反代见 **`docs/LlmProxy.md`**；内含对 Architecture.md 的引用）。

用户、角色、配额与运维 CLI 见 **`docs/UserManagement.md`**。Desktop / 原生客户端 HTTP+WS 接入见 **`docs/ApiClient.md`**。
