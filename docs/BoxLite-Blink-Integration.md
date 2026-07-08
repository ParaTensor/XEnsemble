# BoxLite Runtime Provider 与 Blink 集成分析与推进方案

> 状态：分析阶段（未实施）  
> 日期：2026-06-26  
> 目的：记录使用 `/Users/xinference/github/blink` 作为后端 Agent 沙箱，替代现有本地进程隔离的完整分析、差距、风险与分阶段方案。  
> 对齐：`docs/Architecture.md` §5.4.2 BoxLite Managed Sandbox Runtime（Phase 3）

**重要**：本文档仅为分析与规划，**暂不改动任何代码**。所有实现决策需在本文档评审通过后推进。

---

## 1. 结论与定位

Blink **不是另起炉灶**，而是 Architecture.md §5.4.2 所定义的 **BoxLite Managed Sandbox Runtime（方案 B）** 的真实实现。

- Blink 提供基于 libkrun 的硬件级 microVM 隔离。
- XEnsemble 控制面通过 `BoxLiteRuntimeProvider` + 四个 Adapter 接入。
- Blink 仓库内 `docs/XENSEMBLE.md` 已完整定义 REST/WS 映射到 RuntimeProvider / ExecAdapter / FsAdapter / PreviewAdapter 四层接口。
- 当前 `server/src/runtime/BoxLite*.js` 为 501 占位，通过 `RUNTIME_PROVIDER=boxlite` 即可切换。
- 集成方式：XEnsemble 旁路启动 `blink-server` sidecar，控制面 Adapter 改为 HTTP 客户端调用。**控制面（auth/quota/session/DB/Gateway/LLM）几乎不动**。

这是目前“正确且低契约风险”的替代本地进程隔离的路线。

### 1.1 多沙箱抽象归属（决策）

出现 blink 之外的沙箱技术（如 Tencent [CubeSandbox](https://github.com/tencentcloud/CubeSandbox)、在线/托管沙箱 API）时，**在 XEnsemble 控制面新增一档 `RuntimeProvider` 接入，不在 blink 内部再造"多厂商 broker"**。原因：

- Blink 自身定位为"基于 BoxLite/libkrun 的 execution plane（library + service + CLI）"，把登录/配额/console 留给控制面；让它 broker 其它厂商会造成定位冲突与依赖倒置（控制面依赖执行后端，而非相反）。
- 针对 agent 生命周期的编排与能力协商都在控制面，沙箱抽象自然落在控制面的四层接口（`RuntimeProvider / ExecAdapter / FsAdapter / PreviewAdapter`）上。
- **优先复用 blink 的 REST 契约（`docs/XENSEMBLE.md`）作为归一化协议**：为厂商写 shim 说这套 REST 方言，即可复用现成的 `BoxLite*Adapter`，省去一整套 Adapter；差异过大再单独实现 Provider。即抽象是协议，blink 是参考实现之一。

完整规范见 `docs/Architecture.md` §5.4.4。

---

## 2. 现有隔离机制 vs Blink

### 2.1 当前“后台进程隔离”（Local Runtime）

- **本质**：同主机进程级隔离。
- LocalExecAdapter 使用 `node-pty` 在宿主机直接 spawn agent CLI。
- LocalRuntimeLimits 使用 `systemd-run`（cgroups v2）或回退 `prlimit/nice` 限资源。
- 配合 `RUNTIME_UID/GID` 独立 OS 用户 + `LocalFsAdapter` 目录 jail。
- **共享边界**：Agent 与控制面共享同一内核、文件系统、网络栈。
- **隔离强度**：OS 进程级 + 目录限制 + 可选 cgroups。

### 2.2 Blink（libkrun microVM）

- 每个 session 一台独立 VM。
- 独立 rootfs（默认 `alpine:3.20`）、独立磁盘、独立内核边界。
- 额外能力：checkpoint/restore、export/import、warm session。
- **隔离强度**：硬件虚拟化级（质变）。

### 2.3 对比小结

| 维度           | Local Process              | Blink (BoxLite)                  | 影响                     |
|----------------|----------------------------|----------------------------------|--------------------------|
| 隔离级别       | 进程 + cgroups + 目录 jail | 硬件 VM（libkrun）               | 安全边界大幅提升         |
| 文件系统       | 宿主机目录                 | VM 内磁盘（或 virtiofs 映射）    | Workspace/Git/FS 模型变化 |
| 网络           | 宿主机网络栈               | VM 内独立网络                    | Preview 端口转发成为硬缺口 |
| 持久化         | 宿主机目录                 | 持久磁盘 + snapshot/export       | 部署 revision、迁移能力  |
| Agent CLI 位置 | 宿主机安装                 | 必须在 guest 镜像内              | 镜像化生命周期重构       |
| 可恢复性       | 跨重启不可恢复             | attach 消费性 + warm session 优势 | 目标改为**可恢复**：见 `docs/DurableSessions.md`（transcript 续传 + state 目录 resume + reattach） |
| 平台要求       | 任意                         | Linux + KVM                      | 端到端测试受限           |

---

## 3. 契合点（为什么可行）

1. **协议同构**  
   Blink 的 `POST /api/sessions/{name}/spawn` + `WS /executions/{id}/attach`：
   - 二进制帧：`0x01` = stdout、stdin 原始字节
   - JSON 控制：`{"type":"resize"}`、`{"type":"exit"}`
   与 `terminalBridge.js` 的 `input/resize/output/exit` 模型几乎一一对应。

2. **接口对齐**  
   `ExecAdapter.spawn/exec`、`RuntimeProvider.ensureReady/destroy/attachSession` 已在接口定义中。  
   `docs/XENSEMBLE.md` 已给出完整映射表。

3. **信任模型匹配**  
   Blink **不做鉴权**，默认仅监听 `127.0.0.1`。鉴权、配额、审计完全留在 XEnsemble 控制面，与当前架构分工一致。

4. **控制面契约稳定**  
   Desktop/Web 客户端、SessionManager（仅持 handle）、Deployment 状态机、LLM Gateway、Preview Gateway（对外路径）均不直接感知底层 provider。

---

## 4. 主要差距与风险（必须解决）

| 差距类别           | 具体问题                                                                 | 风险等级 | 解决方向                              |
|--------------------|--------------------------------------------------------------------------|----------|---------------------------------------|
| spawn 时序         | 当前 `spawn` 同步返回 StreamHandle；Blink 是先 POST 再 WS attach         | 高       | 改异步或 pending handle               |
| Agent CLI 位置     | 8 个内置 agent 靠宿主机 `npm -g` / curl 安装，VM alpine 里没有           | 高       | 自定义 OCI 镜像预装                   |
| Workspace 模型     | `workspacePath` 目前是宿主机可直接访问目录；git/fs/preview 全依赖它      | 高       | virtiofs 映射 或 全 guest 内 exec     |
| FsAdapter          | Blink 当前无原生文件列/读端点（文档标注“规划中 / 经 exec 间接”）         | 中       | 先用 exec 兜底，后续等 Blink FS API   |
| Preview 端口转发   | LocalPreviewAdapter + localPreviewRegistry + gateway 直代 127.0.0.1:port | **最高** | 需 Blink 侧补 guest→host 转发能力     |
| 恢复模型           | `execution_id` attach 后即消费；跨重启 live PTY 不可恢复                 | 中       | **改为可恢复**：控制面 `reattach(stream_ref)` 重连 sandbox 的 `WS /executions/{id}/attach`，配合 transcript 续传与 state 目录 `--resume`（见 `docs/DurableSessions.md` §5、§9-Q2/Q3）|
| 平台依赖           | 必须 Linux + KVM；当前开发环境无 /dev/kvm                              | 中       | 端到端测试在 KVM 主机上做             |
| 控制面泄漏 Local   | SessionManager require LocalScrollbackBuffer、reconcile 硬解析 pid、preview gateway 绑定 local registry | 中       | 抽象化、按 provider 分支              |

---

## 5. 运行时接口映射（对齐 XENSEMBLE.md）

| XEnsemble 接口                        | Blink API                                              | 说明                                      |
|---------------------------------------|--------------------------------------------------------|-------------------------------------------|
| `RuntimeProvider.ensureReady`         | `POST /api/sessions`                                   | name 建议用 runtimeId 或稳定映射          |
| `RuntimeProvider.destroy`             | `DELETE /api/sessions/{name}`                          | 销毁沙箱                                  |
| `RuntimeProvider.attachSession`       | `WS /api/sessions/{name}/executions/{id}/attach`       | PTY 流（需先 spawn）                      |
| `ExecAdapter.spawn`                   | `POST /api/sessions/{name}/spawn` + WS attach          | PTY 交互终端（tty: true）                 |
| `ExecAdapter.exec`                    | `POST /api/sessions/{name}/runs` 或 ephemeral `/runs`  | 短任务 / git 操作                         |
| Snapshot / checkpoint                 | `POST /api/sessions/{name}/checkpoints`                | 对接 Deployment revision                  |
| Restore                               | `POST /.../checkpoints/{snap}/restore`                 | -                                         |
| Export / Import                       | `/export` + `/import`                                  | 环境迁移                                  |
| `FsAdapter.*`                         | （规划中）或经 session 内 exec 间接                    | 目前先用 exec 兜底                        |
| Preview                               | 暂无（需 Blink 侧新增端口转发或 preview 端点）         | BoxLitePreviewAdapter 的硬缺口            |

**Session 命名策略**：控制面维护 `runtimeId ↔ blinkSessionName` 映射（可复用 `runtimes.runtimeRef`），**绝不向客户端暴露** Blink session 名或 box id。

---

## 6. 分阶段推进方案（严格按 Architecture.md Phase 3）

### 阶段 0：准备（零功能改动，搭通链路）

- 添加 `BLINK_API_URL` 配置与健康探活（调用 `/api/health`）。
- 在 `runtimes` 表或运行时映射中存储 `runtimeId ↔ blinkSessionName`（不暴露）。
- 清理控制面 Local 硬编码泄漏：
  - `SessionManager` 中的 `LocalScrollbackBuffer` 依赖抽象化
  - `reconcileRunningSessions` 增加 provider 区分
  - `preview/gateway.js` 与 `localPreviewRegistry` 解耦准备
- 在有 KVM 的主机上部署 `blink-server` release 二进制（推荐 sidecar 或 systemd）。
- 目标：`RUNTIME_PROVIDER=boxlite` 能启动，provider 能连通 blink-server，不再 501。

### 阶段 1：会话 + 终端（核心，先验证隔离与体验）

- `BoxLiteRuntimeProvider.ensureReady` → `POST /api/sessions`（支持 warm）
- `destroy` → `DELETE`
- `BoxLiteExecAdapter.spawn`：
  - `POST /spawn`（`tty: true`）
  - 拿到 `execution_id` + `attach_url`
  - 建立 WS 连接，封装 `BoxLiteStreamHandle` 适配 `onData/write/resize/kill/onExit`
- 解决 spawn 同步 → 异步问题（推荐把 spawn 契约调整为 async，或内部 pending 就绪后再返回可用 handle）。
- 打通 Desktop 终端双向通信、resize、exit。
- 临时验证：先用 guest 内 `sh` / `node` 跑通 PTY，不涉及真实 agent CLI。
- 目标：**Desktop 终端在 VM 内跑 agent** 可验证。

### 阶段 2：镜像与 Agent 生命周期

- 构建自定义 OCI 镜像：`alpine:3.20` + node + git + 8 个内置 agent CLI 预装。
- `ensureReady` 时指定 image（或默认 + virtiofs 额外挂载）。
- 重构 `agentLifecycle.js`：从“宿主 npm -g”改为“镜像版本管理 + 运行时校验”。
- 支持 per-runtime / per-project 指定镜像。

### 阶段 3：Workspace / Git / FS

**必须先做决策（二选一）**：

- **A. virtiofs 映射**：把宿主 workspace 目录映射进 VM。git/fs/preview 代码改动最小，workspacePath 语义接近本地。
- **B. 全 guest 内**：workspace 完全在 VM 磁盘，clone/commit/fsList 全部走 `ExecAdapter.exec`（git 已抽象 exec，友好）。

FsAdapter 实现策略：
- 阶段 1~2 先通过 session 内 exec（`ls`、`cat`）实现 `fsList` / `fsRead` 兜底。
- 后续 Blink 提供原生文件 API 再替换。

### 阶段 4：Preview / Deployment

- 推动 Blink 侧增加 guest 端口转发或 `/sessions/{name}/preview` 注册端点。
- 实现 `BoxLitePreviewAdapter`。
- 重构 `preview/gateway.js`：不再硬依赖 `localPreviewRegistry`，改为从 provider 获取目标地址。
- checkpoint/restore 对接 `deployment.revision`。
- export/import 对接迁移场景。

### 阶段 5：灰度与生产化

- 支持 per-project 或 `runtime_providers` 表选择 provider，实现 boxlite 与 local 并存。
- 灰度稳定后切默认。
- 补全 metrics、日志、告警、健康检查。
- 完善部署文档（KVM 要求、镜像构建、sidecar 部署）。

---

## 7. 控制面侵入面概览

**低侵入（推荐优先落地）**：
- 仅实现/替换 `server/src/runtime/BoxLite*.js` 四个文件
- `runtime/registry.js` 已支持切换
- server.js 中 `runtime.exec.spawn(...)` 调用点调整为异步
- DB 映射（runtimeRef 复用或新增字段）
- 少量配置（BLINK_API_URL）

**中等侵入**：
- spawn 契约改为 async（或内部 pending）
- SessionManager 去 Local 化（scrollback、reconcile）
- preview/gateway.js 泛化，不再绑定 local registry

**高侵入 / 依赖外部**：
- Agent 镜像化（阶段 2）
- Workspace 模型选型（阶段 3）
- Preview 端口转发（阶段 4，依赖 Blink 侧演进）

**几乎不动**：
- Auth / Policy / Session 业务逻辑 / Deployment 状态机 / LLM Gateway / 客户端协议

---

## 8. 关键决策点（推进前必须明确）

1. **spawn 契约是否接受异步化？**（推荐接受，语义正确，影响可控）
2. **Workspace 模型选型**：virtiofs 映射 vs 全 guest 内？（强烈建议阶段 3 前拍板）
3. **Preview 策略**：阶段 1/2 先不做预览，专注终端验证？还是同步推动 Blink 侧补能力？
4. **Agent 分发方式**：镜像 bake（推荐，稳定）还是每次 copy-in + 运行时安装？
5. ~~**恢复模型接受度**：`recoverable=false` + attach 消费性~~ → **已在 `docs/DurableSessions.md` 拍板改为可恢复**：BoxLite/blink 作为“进程脱离控制面”的主路径，控制面重连 sandbox attach 流 + transcript 续传 + state 目录 resume，`recoverable` 提升为 `true`（能力分级见该文档 §9-Q3）
6. **平台与测试**：端到端验证必须在有 `/dev/kvm` 的 Linux 主机上进行，darwin 仅能做单元/集成 mock。
7. **FsAdapter 兜底策略**：先用 exec 实现，还是等 Blink 原生 API？

---

## 9. 验证路径建议（阶段化里程碑）

1. **阶段 0 验证**  
   KVM 主机起 `blink-server`，`/api/health` 返回正常；XEnsemble 切 `RUNTIME_PROVIDER=boxlite` 后能启动且 provider 能连通。

2. **阶段 1 验证（核心）**  
   创建 session 后，Desktop 终端能双向交互、resize、收到 exit；通过 guest 内 `ps` 或文件确认 agent 进程在 VM 内运行。

3. **阶段 2 验证**  
   自定义镜像构建成功；使用预装 agent CLI 启动 session 成功。

4. **阶段 3 验证**  
   git clone / commitAll / fsList / fsRead 通过对应 adapter 正常工作。

5. **阶段 4 验证**  
   Preview 能启动并通过 `/preview/:deploymentId` 访问（需 Blink 侧端口转发就绪）。

6. **阶段 5 验证**  
   同项目可按 runtime 切换 local / boxlite；灰度切换无感。

---

## 10. 参考资料

- XEnsemble
  - `docs/Architecture.md`（尤其是 §5.4.2、Phase 3、部署拓扑）
  - `docs/GitWorkflow.md`（git 操作在 Runtime 侧执行）
  - `server/src/runtime/interfaces.js`（四层接口定义）
  - `server/src/runtime/registry.js`
  - 当前 BoxLite* 占位实现

- Blink（外部仓库 `/Users/xinference/github/blink`）
  - `README.md`
  - `docs/XENSEMBLE.md`（控制面集成契约，最重要）
  - `docs/PTY.md`（spawn + WebSocket 协议）
  - `docs/STREAMING.md`（Pipe / PTY 双轨）
  - `docs/PRODUCT.md`
  - `src/server/src/api/sessions.rs`、`exec.rs`（REST 实现参考）

- 相关约束
  - AGENTS.md（必须先读 Architecture.md）
  - 任何直接依赖本机 FS/PTY 的假设仅限 Local 实现内部

---

## 附录：当前代码中与 Local 强绑定的点（供后续清理参考）

- `SessionManager.js`：直接 require `LocalScrollbackBuffer`
- `reconcileRunningSessions.js`：硬解析 `local:pty:` + pid
- `preview/gateway.js`：硬依赖 `localPreviewRegistry`
- `preview/lifecycle.js`：同上
- `LocalScrollbackBuffer.js`：路径与本地文件系统耦合
- `server.js` spawn 调用点：同步消费 handle
- `agentLifecycle.js`：全部假设宿主机安装（boxlite 路径见 [`Agent-Images.md`](./Agent-Images.md)）
- `workspace.js` + `LocalFsAdapter`：假设宿主机路径可直接访问
- `LocalGitService`：当前通过 exec adapter，已相对抽象（较友好）

---

**本文档为后续实现与评审的唯一依据。任何实现前请先更新本文档并确认关键决策。**