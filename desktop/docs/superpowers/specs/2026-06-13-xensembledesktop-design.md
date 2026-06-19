# XEnsembleDesktop 设计文档

## 1. 背景与目标

XEnsemble（`/Users/xinference/github/XEnsemble`）是一个基于浏览器运行的 agent-run 平台，前端为 React 18 + Vite 5，后端为 Fastify 4 + Node 20。我们希望为它创建一个桌面客户端 **XEnsembleDesktop**，让用户能够以原生应用的形式使用 XEnsemble，同时保持后端由官方或用户自行部署在远程，桌面端本身不运行任何服务端进程。

**目标：**
- 在 `XEnsembleDesktop` 独立仓库中构建一个跨平台桌面客户端。
- 最大化复用 XEnsemble 现有的 `client/` 前端代码。
- 桌面端只负责 UI 渲染、窗口/菜单生命周期、本地文件桥接、后端地址配置与安全存储。
- 所有业务逻辑、会话、PTY、文件系统、数据库继续由远程 XEnsemble 后端处理。

## 2. 关键约束

经过需求澄清，以下约束已确认：

1. **纯客户端**：桌面端不启动本地 Fastify/Node 服务，不运行本地执行环境。
2. **独立仓库**：`XEnsembleDesktop` 作为独立仓库维护，参考/复用 XEnsemble 的 `client/`。
3. **无离线模式与本地缓存**：暂不需要离线使用或本地数据缓存。
4. **无自动更新**：暂不考虑自动更新机制，未来再评估。
5. **后端可配置**：用户需要能输入并保存远程后端地址（默认可提供官方地址）。

## 3. 交互设计原则

### 3.1 按钮 Loading 状态

任何会触发异步请求或需要等待结果的操作按钮，在点击后必须立即进入 loading 状态：

- 按钮置为 `disabled`，防止重复提交。
- 按钮文字变为当前操作的进行态，例如：
  - **Sign In** → **Signing in…**
  - **Sign Up** → **Creating account…**
  - **Save** → **Saving…**
  - **Delete** → **Deleting…**
  - **Run** / **Execute** → **Running…**
- 操作完成后（无论成功或失败），按钮恢复为可用状态。
- 如果操作耗时较长，可同时显示 loading toast（可选）。

该原则适用于所有表单提交、API 调用、文件上传下载、配置保存等需要等待响应的按钮。

## 4. 方案选择

考虑过三种方案：

| 方案 | 描述 | 优点 | 缺点 |
|---|---|---|---|
| A. Electron 纯客户端 | Electron 壳 + 复用 React/Vite 前端，直接连接远程后端 | 复用度最高、桌面能力最成熟、类似 Cursor Desktop | 包体积中等偏大 |
| B. Tauri 纯客户端 | Tauri 壳 + 复用 React 前端 | 包小、内存低 | CORS 处理复杂、生态成熟度不如 Electron |
| C. PWA + 最小 Electron 壳 | 仅作为可安装窗口 | 改动最小 | 桌面能力弱 |

**选定方案：A（Electron 纯客户端）**。原因：

- XEnsemble 已是 React/Vite，Electron 可几乎原样复用前端。
- 不需要本地 Node 后端后，Electron 的复杂度和包体积都会显著低于 emdash。
- emdash 的 renderer/preload/打包配置可作为重要参考，但 main 进程逻辑会大幅简化。

## 5. 总体架构

```
┌─────────────────────────────────────────┐
│         XEnsembleDesktop (Electron)      │
│  ┌─────────────────────────────────┐    │
│  │      Renderer (React/Vite)       │    │
│  │   复用 XEnsemble client 代码      │    │
│  │   • Console / Sessions / Admin   │    │
│  │   • xterm.js WebSocket 终端       │    │
│  │   • 文件树、预览面板              │    │
│  └──────────────┬──────────────────┘    │
│                 │ fetch / WebSocket      │
│  ┌──────────────▼──────────────────┐    │
│  │   Preload (最小 API 桥接)        │    │
│  │   • getBackendURL()             │    │
│  │   • setBackendURL()             │    │
│  │   • selectFile / saveFile       │    │
│  │   • secureTokenStore            │    │
│  │   • openExternal                │    │
│  └──────────────┬──────────────────┘    │
│                 │ IPC                    │
│  ┌──────────────▼──────────────────┐    │
│  │   Main Process (Node/Electron)   │    │
│  │   • 窗口/菜单/生命周期           │    │
│  │   • 本地配置 & Keychain          │    │
│  │   • 系统文件对话框               │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
                         │
                         ▼
            远程 XEnsemble 后端服务
            (用户自托管或官方云)
```

## 6. 目录结构

```
XEnsembleDesktop/
├── package.json
├── electron.vite.config.ts
├── electron-builder.config.ts
├── tsconfig.json
├── src/
│   ├── main/
│   │   ├── index.ts              # 应用入口
│   │   ├── app/
│   │   │   ├── window.ts         # BrowserWindow 创建与管理
│   │   │   ├── menu.ts           # 应用菜单与快捷键
│   │   │   └── protocol.ts       # app:// 自定义协议（生产环境加载本地产物）
│   │   ├── services/
│   │   │   ├── config.ts         # 后端地址、用户设置持久化
│   │   │   └── secureStore.ts    # 系统 keychain/os-keyring 存储 token
│   │   └── ipc/
│   │       └── handlers.ts       # IPC 处理器注册
│   ├── preload/
│   │   └── index.ts              # contextBridge 暴露的 API
│   ├── renderer/
│   │   └── (复用 XEnsemble client 代码，或作为入口引用)
│   └── shared/
│       └── ipc.ts                # IPC 类型定义
├── resources/                    # 图标、静态资源
└── xensemble-client/             # 可选：git submodule 或 workspace 引入 XEnsemble/client
```

> **说明**：`xensemble-client/` 的具体引入方式（git submodule / pnpm workspace / 构建时复制）在实现计划中确定。本设计保持灵活，核心目标是让 renderer 能复用 XEnsemble 的 React 组件、页面、样式和工具函数。

## 7. 前端复用策略

1. **入口复用**
   - renderer 的入口直接引用 XEnsemble `client/src/main.jsx` 和 `client/index.html`。
   - 构建配置中设置 alias，使 `src/` 指向 XEnsemble client 的源码目录。

2. **API 地址改造**
   - 当前 `client/src/lib/api.js` 硬编码为 `http://${window.location.hostname}:3000`。
   - 改造为从 `window.xensembleDesktopAPI.getBackendURL()` 获取后端地址。
   - 在浏览器环境中（即不通过桌面端运行时），可退化到 `window.location.origin` 或原有硬编码逻辑。

3. **WebSocket 改造**
   - 终端 WebSocket 连接同样使用配置的后端地址。
   - 需要支持 `wss://` 和 `ws://`。

4. **最小侵入原则**
   - 尽量不在 XEnsemble client 中引入 Electron 特有的代码。
   - 通过 `window.xensembleDesktopAPI` 是否存在判断当前是否运行在桌面端，从而切换行为。

## 8. 后端连接

### 7.1 后端地址配置

- **首次启动**：如果未配置后端地址，显示欢迎/设置界面让用户输入。
- **默认地址**：可内置官方云服务地址（占位，待后续确定）。
- **修改入口**：菜单 `XEnsemble > Settings` 或欢迎界面。
- **持久化**：存储在 Electron 的 `userData` 配置文件中。

### 7.2 认证

- 复用 XEnsemble 现有的 JWT 登录流程。
- Access token 保存在内存中（或前端 store）。
- Refresh token 通过 preload 提供的 `secureTokenStore` 保存到系统 keychain。
- 登录态通过现有 `/api/auth/*` 接口与远程后端交互。

### 7.3 网络

- renderer 直接通过 `fetch` / `WebSocket` 访问远程后端。
- 如果后端需要处理跨域，需确保远程 Fastify 的 CORS 配置允许桌面端来源。
- 生产环境可考虑通过 preload 注入请求代理，但尽量保持简单，直接访问远程。

## 9. 本地能力

桌面端需要暴露给前端的最小能力集合：

| 能力 | 用途 | 暴露方式 |
|---|---|---|
| `getBackendURL()` / `setBackendURL()` | 读取/保存后端地址 | preload API |
| `selectFile(options)` | 上传文件前选择本地文件 | preload API + 系统对话框 |
| `saveFile(blob, filename)` | 下载文件到本地 | preload API + 系统对话框 |
| `secureTokenStore.get/set/delete()` | 安全存储 token | preload API + keychain |
| `openExternal(url)` | 用系统浏览器打开链接 | preload API |
| `getAppVersion()` | 显示版本号 | preload API |

**文件上传/下载流程**：

- 上传：用户触发上传 → 调用 `selectFile` 获取文件内容和元数据 → 前端通过 `fetch` 上传到远程后端。
- 下载：后端返回文件内容 → 前端调用 `saveFile` 调起系统保存对话框 → 写入本地。

## 10. 安全

- `contextIsolation: true`，`nodeIntegration: false`。
- preload 脚本通过 `contextBridge.exposeInMainWorld` 仅暴露白名单 API。
- 不暴露原始 `ipcRenderer` 或 Node API 给 renderer。
- 生产环境设置合理 CSP，限制脚本来源为 `app://`。
- Token 不直接存入 `localStorage`，而是通过 secure store。

## 11. 构建与打包

### 10.1 开发

- 使用 `electron-vite` 同时构建 main、preload、renderer。
- dev 模式下 renderer 使用 Vite dev server，main 进程加载 dev server URL。
- 后端地址可配置为本地 XEnsemble server（开发调试时使用 `http://localhost:3000`）。

### 10.2 生产

- renderer 构建为静态产物，通过 `app://` 自定义协议加载。
- `electron-builder` 打包为：
  - macOS：`.dmg`、`.zip`（arm64，后续可扩展 x64）
  - Windows：`.exe`（NSIS）
  - Linux：`.AppImage`（后续可扩展 deb/rpm）
- 暂不需要代码签名和自动更新（未来再考虑）。

### 10.3 原生依赖

- 由于不做本地执行，不需要 `node-pty`、`better-sqlite3` 等原生模块。
- Electron 主进程只使用 Electron 内置 API 和普通 Node API，无需 `electron-rebuild` 处理额外原生依赖。

## 12. 排除项（明确不做）

以下功能在当前阶段明确排除，未来可再评估：

1. **本地 Fastify/Node 后端**：不在桌面端启动任何服务端进程。
2. **本地执行环境/PTY**：不集成 `node-pty` 或本地 shell。
3. **本地数据库/缓存**：不集成 `better-sqlite3`，不做本地数据缓存。
4. **离线模式**：必须连接远程后端才能使用。
5. **自动更新**：暂不提供自动更新，后续再考虑 `electron-updater`。
6. **代码签名与 notarization**：第一阶段打包无需签名（除非分发需要）。

## 13. 与 emdash 的参考关系

| 方面 | emdash | XEnsembleDesktop |
|---|---|---|
| 桌面框架 | Electron + electron-vite | Electron + electron-vite |
| 本地后端 | 有（Node + SQLite + PTY） | 无 |
| 原生模块 | `node-pty`、`better-sqlite3` 等 | 无 |
| 数据持久化 | 本地 SQLite | 仅配置和 token |
| main 进程 | 复杂，承载大量业务 | 极简化，只负责窗口/配置/桥接 |
| preload/RPC | 复杂 typed RPC | 最小 API 集合 |
| 自动更新 | 有 | 无（暂不做） |

**可借鉴 emdash 的部分**：
- `electron-vite` 三入口配置。
- `BrowserWindow` 与 preload 的安全配置。
- 自定义协议 `app://` 加载生产产物。
- 菜单和窗口生命周期管理。

**不可照搬的部分**：
- main 进程中的 domain controllers、SQLite、PTY、文件 watcher 等本地服务全部不需要。

## 14. 风险与后续

1. **XEnsemble client 的 API 地址耦合**：`client/src/lib/api.js` 目前硬编码后端地址，需要改造为可配置。这需要在 XEnsemble 仓库或桌面端做适配。
2. **CORS 配置**：远程后端需要允许桌面端的来源。如果使用 `app://` 协议，CORS 配置需要相应调整。
3. **WebSocket 终端**：xterm.js 的 WebSocket 连接需要能动态指向远程后端，需验证路径和认证头携带。
4. **子模块/工作区管理**：如何持续同步 XEnsemble client 的更新，需要选择一个可持续的引入方式。
5. **后续扩展**：自动更新、本地缓存、离线模式、插件系统等可作为未来版本规划。

## 15. 验收标准

- `XEnsembleDesktop` 仓库能 `npm install && npm run dev` 启动桌面应用。
- 应用首次启动能配置远程后端地址，并能成功登录。
- 主要功能（会话列表、终端、文件树、预览、admin 页面）与 Web 端行为一致。
- 能调用系统文件对话框完成上传/下载。
- 能打包出 macOS/Windows/Linux 可分发产物。
