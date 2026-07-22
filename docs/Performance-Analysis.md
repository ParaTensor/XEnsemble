# XEnsemble 性能分析报告

> 日期：2026-07-22
> 状态：已完成分析，待实施优化

---

## 一、分析范围

对以下流程进行端到端性能分析：
1. New Agent 启动流程
2. Agent 使用流程（终端交互、WebSocket 流式传输）
3. 文件处理与编辑流程
4. Session Stop/Start 流程
5. 页面显示与渲染流程

---

## 二、核心瓶颈排序

### P0 — 致命（影响可用性）

| # | 瓶颈 | 位置 | 影响 |
|---|---|---|---|
| P0-1 | **WS 无背压控制** | `terminalBridge.js` + `SessionManager.js:69-76` | 慢消费者导致服务端 OOM；多 subscriber 时一个慢连接拖垮全部 |
| P0-2 | **每 PTY chunk 一次同步 `fs.appendFileSync`** | `TranscriptStore.js:217` | 高频输出时阻塞事件循环（10-100 次/秒 sync 系统调用） |
| P0-3 | **每按键一次同步 `fs.appendFileSync`** | `server.js:1409` | 用户输入时阻塞事件循环 |

**验证结果**：
- `sendJson()` 仅检查 `readyState === OPEN`，无 `bufferedAmount` 检查，无 `maxPayload` 配置
- `outputListeners` 为无界 `Set`，无上限
- `_writeFileLine` 是 TranscriptStore 的唯一写入路径，无任何缓冲/合帧/节流
- `ws.send()` 失败时静默吞掉错误（`catch (_) {}`）
- BoxLite 路径存在双重无界缓冲（VM→server + server→browser）

### P1 — 严重（影响启动速度）

| # | 瓶颈 | 位置 | 影响 |
|---|---|---|---|
| P1-1 | **16-17 次冗余 DB 查询 / session start** | `server.js` + `agentEnv.js` | 启动延迟增加 30-80ms |
| P1-2 | **BoxLite warm-start 每次清缓存** | `BoxLiteRuntimeProvider.js:cleanCaches` | 每次启动都摧毁 npm cache，agent 重新下载依赖 |
| P1-3 | **BoxLite warm-start 冗余操作链** | `BoxLiteRuntimeProvider.ensureReady` | 即使 VM 已就绪，仍跑 openSession→cleanCaches→probe→bootstrap 全链 |
| P1-4 | **`gatewaySettings.getConfig()` 4 次单行查询** | `GatewaySettings.js:31` | 应一次 `getAll()` 替代 |
| G1 | **`resolveTerminalThemeContext` 每次都查全表** | `agentEnv.js:214-233` | session start 额外 DB 开销 |
| G2 | **`server.js:1040-1044` 先调 `getAgentAuthMode` 再调 `getForAgent`，然后 `resolveSpawnEnv` 内部再重复** | `server.js:1040-1054` | 同一数据查多次 |
| G3 | **LLM 代理每次请求 3 个串行 DB 查询** | `llm/proxy.js:104-175` | 每次 LLM 请求增加延迟 |

**验证结果**：
- 单次 Gateway 模式 session start 共 ~19 次 DB 查询，其中 ~16-17 次为冗余
- `agent_gateway_config` 行被查询 5 次
- `gateway_*` 配置（4 key）被查询 12 次（4×3 次 `getConfig()` 调用）
- `agents` 表行被查询 2 次
- 所有配置服务（`AgentGatewayConfig`、`PlatformSettings`、`PlatformSecrets`、`UserPreferences`、`GatewaySettings`）均无缓存层
- `applyRuntimeConfig` 调用 `getConfig()` 后，`resolveBindAddr` 又调用 `getConfig()` —— 背靠背重复
- `resolveLlmPublicRouterBase` 第三次调用 `getConfig()`

### P2 — 中等（影响交互体验）

| # | 瓶颈 | 位置 | 影响 |
|---|---|---|---|
| P2-1 | **死轮询：10s 间隔的无效文件列表请求** | `Sessions.jsx:583-600` | 浪费带宽和服务器资源，UI 无感知 |
| P2-2 | **文件树无实时更新机制** | `WorkspaceFileTree.jsx` | Agent 创建/修改文件后用户看不到，需手动折叠/展开 |
| P2-3 | **无代码分包** | `vite.config.js` + `App.jsx` | 首屏加载 ~7-9MB 单一 bundle（gzip ~2-3MB） |
| P2-4 | **`buildWorkspaces()` 未 memoize** | `AppSidebar.jsx:563` | 每次 render 都 O(n) 扫描 sessions |
| P2-5 | **`onSelectSession` 回调未 `useCallback`** | `App.jsx:57-66` | 每次父组件 render 导致 AppSidebar 重渲染 |
| P2-6 | **live 输出无 batch** | `terminalBridge.js:201-215` | 每帧单独 `ws.send` + `JSON.stringify`，高频输出时开销大 |
| P2-7 | **每次 `terminal.write` 前读 DOM 强制 reflow** | `AgentConsole.jsx:310-311` | 高频输出时 100+ 次/秒 reflow |
| G4 | **LLM 配额 `buckets` Map 从不清理** | `llm/quota.js:11` | 时间窗口键无限增长，内存泄漏 |

### P3 — 轻微

| # | 瓶颈 | 位置 | 影响 |
|---|---|---|---|
| P3-1 | `waitForAgentExit` 10s 超时且无 SIGKILL 兜底 | `idleHibernate.js:5-41` | 僵尸进程可能残留 |
| P3-2 | `stop` 时 git auto-checkpoint 无条件执行 | `idleHibernate.js:129-132` | 增加 500ms-2s |
| P3-3 | `Sessions.jsx` 38 个 `useState`（非 50+） | `Sessions.jsx:104-170` | 任一 state 变化触发全组件树重渲染 |
| P3-4 | `withResumeLock` 无超时 | `resumeSession.js:15-25` | 并发 resume 可能死锁 |
| G5 | `expirePreviews` 串行处理 | `preview/lifecycle.js:54-83` | 批量过期时阻塞事件循环 |
| G6 | `startPreviewLifecycle` 的 `setInterval` 无清理 | `preview/lifecycle.js:89-91` | 测试/重启时泄漏 |

---

## 三、优化方案

### P0 — 致命（必须立即修复）

#### P0-1: WS 背压控制
- 在 `sendJson()` 中加入 `bufferedAmount` 高水位检查（>1MB 则关闭连接）
- `outputListeners` 通知改为异步批量（microtask 合帧），避免同步 `for...of` 阻塞
- 设置 `outputListeners` 最大数量（如 5）
- WS server 配置 `maxPayload`
- `ws.send()` 失败时主动关闭连接

**预期收益**：消除 OOM 风险，慢消费者不再影响其他 subscriber

#### P0-2: TranscriptStore 异步批量写入
- 将 `appendFileSync` 替换为 write queue + flush timer（100ms 间隔或 64KB 阈值）
- flush 时用单次 `fs.appendFile` 写入积攒的多行
- 进程退出时强制 flush（`process.on('beforeExit')`）
- 同步处理 `LocalScrollbackBuffer` 和 `logInbox.js` 的同类问题

**预期收益**：磁盘写入从 10-100 次/秒降至 10 次/秒，事件循环不再被阻塞

#### P0-3: 输入侧 transcript 写入批量化
- `server.js:1409` 的 input transcript 写入复用 TranscriptStore 的批量机制

### P1 — 严重

#### P1-1: DB 请求级缓存
- 在 `resolveSpawnEnv` 入口处一次性查出 `platformSettings.getAll()`，将结果传入所有子函数
- 消除 ~12 次冗余查询

#### P1-2: AgentGatewayConfig 加 5s TTL 内存缓存
- 消除 `agent_gateway_config` 行的 5→1 次查询

#### P1-3: resolveSpawnEnv 内 cfg=getForAgent() 一次，推导 mode
- 消除 3→1 次 `getForAgent()` 调用

#### P1-4: gatewaySettings.getConfig() 改用 getAll() 一次取 4 key
- 消除 4→1 次查询

#### P1-5: applyRuntimeConfig 传 config 给 resolveBindAddr
- 消除 8→4 次查询（不再重复调用 `getConfig()`）

#### P1-6: server.js:1040-1044 复用 resolveSpawnEnv 内的 getForAgent 结果
- 消除 2 次额外查询

#### P1-7: resolveTerminalThemeContext 复用入口 getAll() 结果

#### P1-8: UserPreferences 加 5s TTL 缓存

#### P1-9: BoxLite warm-start 快速路径
- `needRecreate=false` 时跳过 `cleanCaches`/`probeAgentCommand`/`ensureAgentBootstrap`
- warm-start 从 2-10s 降至 500ms-1s

#### P1-10: LLM 代理 3 次 DB 查询并行化
- `assertSessionAuthorized`、`checkLlmRequestQuota`、`resolveGatewayTarget` 改为 `Promise.all`

### P2 — 中等

#### P2-1: 删除死轮询代码
- 删除 `Sessions.jsx:583-600` 的 10s 轮询 useEffect

#### P2-2: 文件树实时更新
- 短期：Agent 空闲时（5s 无输出）触发文件树根目录刷新
- 中期：`chokidar`/`fs.watch` + WS 事件推送
- 长期：独立文件事件 WS channel

#### P2-3: 代码分包
- `App.jsx` admin 页面改为 `React.lazy(() => import(...))`
- `vite.config.js` 添加 `manualChunks`（monaco、xterm、vendor）

#### P2-4: buildWorkspaces 包裹 useMemo
- 依赖 `[projects, sessions, sidebarPrefs]`

#### P2-5: onSelectSession 等回调包裹 useCallback

#### P2-6: live 输出 microtask 合帧
- 在 `terminalBridge.js` live 路径加入类似 replay 的 `flushFrames`

#### P2-7: 终端 scroll-bottom 用 rAF 批量检测

#### P2-8: LLM 配额 buckets Map 定期清理过期键

### P3 — 轻微

#### P3-1: waitForAgentExit 加 SIGKILL 兜底
- 超时从 10s 降至 3-5s，超时后 SIGKILL

#### P3-2: stopSession git checkpoint 加 git status --porcelain 预检

#### P3-3: Sessions.jsx 拆分子组件

#### P3-4: withResumeLock 加 30s 超时

#### P3-5: expirePreviews 并行处理

#### P3-6: startPreviewLifecycle 返回清理函数

---

## 四、预期收益汇总

| 优化项 | 当前 | 优化后 | 提升 |
|---|---|---|---|
| Session start DB 查询 | ~19 次 | ~4-5 次 | ~75% |
| BoxLite warm-start | 2-10s | 0.5-1s | ~80% |
| PTY 高频输出时事件循环阻塞 | 10-100 sync writes/s | 10 async flushes/s | 消除阻塞 |
| WS 慢消费者影响 | OOM 风险 | 主动断开 | 消除 OOM |
| 首屏加载（gzip） | ~2-3MB | ~500KB-1MB | ~60% |
| 文件树实时性 | 需手动刷新 | 自动推送 | UX 质变 |