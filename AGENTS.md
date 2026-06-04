# AI Agent 协作规则

## 系统架构（强制对齐）

执行面迁移到独立云环境、Runtime 抽象、Workspace 存储、Preview/Deployment 服务等所有后端实现，必须以 **`docs/Architecture.md`** 为唯一规范。开发或评审相关代码前须阅读该文档；任何直接依赖本机 FS/PTY 的假设仅限 Local 实现内部。

## 前端 UI

`web/`（本仓库 `client/`）的布局、组件与交互以 **`docs/Designs.md`** 为唯一规范（对齐 ParaRouter `DESIGN.md`）。实现或评审前端前须阅读该文档；**勿在本文重复 UI 细则。**

Agent 领域说明与架构对齐要求见 **`docs/agents.md`**（内含对 Architecture.md 的引用）。
