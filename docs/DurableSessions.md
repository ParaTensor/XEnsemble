# XEnsemble 可恢复会话设计（Durable Sessions）

> 状态：设计草案（Design Draft）
> 日期：2026-07-04
> 适用范围：`server/` 控制面 Session / Runtime 子系统
> 上位规范：本文件是 [`docs/Architecture.md`](./Architecture.md) 的补充设计，不覆盖其约束；执行面三层 Provider 抽象（Local / BoxLite / K8s）保持不变。

---

## 0. 一句话目标

在**不接管、不改造被引入的原生 Agent CLI**（Claude Code / Codex / 其它流行 harness）的前提下，让 XEnsemble 的会话具备**断线续传、控制面重启不丢会话、空闲休眠/唤醒**的能力。

做法是三根支柱，全部把 Agent 当**黑盒**：

1. **B 层 Transcript**：在终端字节边界记一条 append-only、带 `seq` 游标的流水，作为会话的持久事实来源。
2. **State 目录持久化**：把 Agent 自带的会话状态目录随 workspace 一起持久化，恢复时用 Agent 原生 `--resume` 续跑。
3. **执行进程脱离控制面**：Agent 进程运行在独立于 control-plane 的被监督宿主里，控制面重启后**重新 attach**，而不是把会话判死。

> **明确不做**：不解析 Agent 内部语义（tool call / turn / message）、不接管 Agent loop、不要求 Agent 配合结构化输出。语义级事件日志（OC 式）是**可选的后续增强**，不是本设计的前置门槛（见 §8）。

---

## 1. 背景：现状为什么会话不可恢复

当前会话状态**绑在控制面进程的内存里**，磁盘上只有一份"尽力而为"的 scrollback。

| 环节 | 现状 | 文件 |
|------|------|------|
| 活会话句柄 | `SessionManager` 用内存 `Map` 持有 `StreamHandle`(PTY)，`history` 是易失缓存 | `server/src/session/SessionManager.js` |
| 磁盘留存 | `LocalScrollbackBuffer` 把 PTY 输出裸字节 `appendFileSync` 到 `.scrollback/<ref>.log`；**无 seq、无输入、无边界、读取截断尾部 100KB** | `server/src/runtime/LocalScrollbackBuffer.js` |
| 前端订阅 | `subscribeTerminal` 先把 `history` 整段回放，再转发实时 `onData`；**无游标，断线只能整段重放或丢失** | `server/src/session/terminalBridge.js` |
| 重启处理 | `reconcileRunningSessions` 检测 `streamRef` 里的 pid，进程不在就把 `running` 直接改 `exited`；`recoverable` 默认 `false` | `server/src/session/reconcileRunningSessions.js`、`server/src/db/schema.js` |
| 进程归属 | `LocalExecAdapter` 用 `node-pty` **由控制面直接 fork**，控制面死则子进程随之消亡 | `server/src/runtime/LocalExecAdapter.js` |

### 现状数据流（as-is）

```mermaid
flowchart LR
  UI[Web/Desktop 终端] -- WS/SSE --> TB[terminalBridge]
  TB --> SM["SessionManager (内存 Map)"]
  SM --> H["StreamHandle / node-pty"]
  H --> AG[Agent CLI 进程]
  SM -. 裸字节, 无 seq .-> SB[".scrollback/*.log"]
  DB[("sessions 表<br/>status/stream_ref/recoverable")] -. 仅元数据 .- SM

  classDef vol fill:#fde,stroke:#c39;
  classDef lost fill:#fee,stroke:#c66;
  class SM,H,AG vol
```

- 红/粉块 = 易失：控制面进程一停，`SessionManager`、`StreamHandle`、Agent 子进程一起没。
- `.scrollback` 虽在盘上，但**不是**结构化流水，无法做"从游标 N 之后精确续传"，也不含用户输入，无法完整重建会话。

**根因**：真相在进程里，不在盘上。下面三根支柱就是把真相搬到盘上，并让算力可丢弃可重连。

---

## 2. 目标架构总览

```mermaid
flowchart TB
  subgraph CP[控制面 control-plane 可随时重启]
    TB[terminalBridge]
    SM[SessionManager]
    RA[ReattachService<br/>启动时重连]
  end

  subgraph Host[执行宿主 独立于控制面]
    SUP[进程监督器 supervisor]
    AG[Agent CLI 黑盒]
    TAP[Transcript 采集点<br/>PTY 输出 + 用户输入]
  end

  subgraph Durable[持久层 唯一事实来源]
    TR[("Transcript<br/>append-only + seq")]
    ST[("Agent State 目录<br/>Claude journal / Codex thread")]
    WS[("Workspace 文件")]
    DB[("sessions 表 + session_streams")]
  end

  UI[Web/Desktop] -- "attach?after=seq" --> TB
  TB --> SM
  SM <-- "attach / write" --> SUP
  SUP --> AG
  AG <--> TAP
  TAP -- "帧 + seq" --> TR
  AG -. 读写 .-> ST
  AG -. 读写 .-> WS
  RA -- "启动: 读 running 会话" --> DB
  RA -- "重连宿主 + 从 seq 续读" --> SUP
  TB -- "回放 seq<=cursor" --> TR

  classDef durable fill:#eef,stroke:#66c;
  class TR,ST,WS,DB durable
```

蓝块 = 持久，控制面与执行宿主都可重启，会话不丢。

---

## 3. 支柱一：B 层 Transcript（终端字节流水）

### 3.1 定位

把 Agent 当黑盒，在 **PTY 字节边界** 记录"进出这个终端的一切"：Agent 输出、用户输入、resize、进程退出。这是 asciinema 式思路——不理解内容，但能**从任意游标精确重放**。

### 3.2 记录格式（帧）

每条 transcript 记录是一个帧（frame），单调 `seq` 递增、不可变、只增不改：

```jsonc
{
  "seq": 1287,                 // 会话内单调自增，续传的游标
  "ts": 1751590000123,         // 毫秒时间戳
  "kind": "out",               // out | in | resize | exit | meta
  "data": "<base64 或 utf8>",  // out/in: 终端字节; resize: {cols,rows}; exit: {code}
  "bytes": 412                 // data 原始字节长度（便于计量/截断）
}
```

- `kind:"out"` = Agent → 终端；`kind:"in"` = 用户 → Agent（**现状 scrollback 完全没记这个**，导致无法重建"用户说了什么"）。
- `seq` 是**会话级**单调序号，是断线续传与重启续读的唯一游标。
- 大块输出可离线到对象存储并在帧里放 `content_ref`（对齐现有 `storageRef` 习惯）；MVP 阶段可先全部内联落盘。

### 3.3 落盘形态

沿用现有"文件 + DB 元数据"的分工，避免一上来就重构存储：

- **帧数据**：追加写到 `WORKSPACE_ROOT/.transcript/<sessionId>.ndjson`（每行一帧，NDJSON），替代裸 `.scrollback`。顺序 append，天然 append-only。
- **游标元数据**：DB 新增轻量表 `session_streams`，记录 `session_id`、`head_seq`（最大 seq）、`bytes`、`storage_ref`，便于列表页/计量/GC，不必扫文件。
- `LocalScrollbackBuffer` 演进为 `TranscriptStore`（`append(frame)` / `readFrom(seq)` / `head(sessionId)`），保留同名黑盒语义，Local 实现内部换成帧格式。

### 3.4 断线续传时序

```mermaid
sequenceDiagram
  participant UI as 前端
  participant TB as terminalBridge
  participant TR as TranscriptStore
  participant SM as SessionManager(live)

  UI->>TB: attach(sessionId, after=last_seq)
  TB->>TR: readFrom(last_seq+1)
  TR-->>TB: 帧[last_seq+1 .. head]
  TB-->>UI: 补齐缺口(按 seq 顺序)
  TB->>SM: subscribe(live onData)
  SM-->>TB: 实时帧(seq 继续递增)
  TB-->>UI: 转发实时帧
  Note over UI,TB: 断线后带最后见到的 seq 重连<br/>= 不丢不重(对齐 EventSource Last-Event-ID)
```

WS/SSE 协议只需在现有 `{type:"output",data}` 上补一个 `seq` 字段，并支持 `attach?after=<seq>`；前端 xterm 侧记住最后 `seq` 即可。

---

## 4. 支柱二：Agent State 目录持久化

### 4.1 关键洞察

**状态持久 ≠ 我们去追踪状态。原生 Agent 自己就存状态。**

- Claude Code 有自己的 session journal / 历史目录，支持 `claude --resume`。
- Codex 有 thread / rollout 状态。
- OC 也承认其 brain 的 provider 状态是靠"checkpoint 一个 state 目录"（Claude journal / Codex thread id）实现的。

所以我们**不重建语义**，只要保住 Agent 自己的状态盘 + 我们的 transcript，恢复就成立。

### 4.2 做法

- 每个 runtime 声明其 Agent 的 **state 目录**（如 `~/.claude/<proj>`、`~/.codex/...`），由 runtime 适配层给出，不写死在控制面。
- state 目录随 **workspace 一起持久化**（workspace 现已持久，见 `server/src/workspace.js`），并纳入现有 checkpoint/snapshot 流程（`repoSnapshots` / workspace checkpoint）。
- **恢复 = 重新拉起 Agent 时带上原生续跑参数**（`--resume` 或等价），指向持久化的 state 目录；transcript 只负责把历史**重放给 UI**，不参与 Agent 语义恢复。

```mermaid
flowchart LR
  subgraph 恢复时
    R1["拉起 Agent (原生 --resume)"] --> R2["Agent 读 state 目录<br/>恢复自己的上下文"]
    R3["TranscriptStore.readFrom(0)"] --> R4["回放历史给 UI 展示"]
  end
  ST[("持久化 state 目录")] --> R2
  TR[("Transcript")] --> R3
```

分工清晰：**state 目录管"Agent 记得自己干到哪"，transcript 管"人能看回全过程"。** 两者都在盘上，互不依赖。

---

## 5. 支柱三：执行进程脱离控制面

### 5.1 为什么这是独立的一件事

会话在控制面重启后消失，**根因不是没日志，是 `node-pty` 子进程作为控制面的子进程一起被杀**。所以"进程存活"和"状态持久"要分开解决——即使有了 transcript，如果 Agent 进程还是控制面的孩子，重启照样中断当前那一轮。

### 5.2 做法（按三层 Provider 分别落地）

统一契约：Agent 进程由一个**独立于 control-plane 生命周期的宿主**托管，控制面通过 `streamRef` **重连**它，而不是持有它的父子关系。

| Provider | 脱离方式 | 备注 |
|----------|----------|------|
| **Local** | Agent 跑在被监督的**独立进程宿主**（如 detached 进程 + 一个常驻 agent-host，或复用 blink/BoxLite 本机形态），控制面通过 socket/PTY handle 重连 | 保留"本机开发简单"的初衷，仅把父子关系解开 |
| **BoxLite** | Agent 天然跑在 sandbox 内，sandbox 生命周期独立于控制面；控制面重连 sandbox 的 exec/PTY 通道 | 与 `docs/BoxLite-Blink-Integration.md` 对齐，最契合本设计 |
| **K8s** | Agent 跑在 Pod 内，控制面重连 Pod 的 attach 流 | 生产层，天然脱离 |

`StreamHandle` 接口补充一个 `reattach(streamRef)` 语义：从 `streamRef` 恢复一个可读写的句柄，而非只在 `createSession` 时新建。

### 5.3 控制面重启重连时序

```mermaid
sequenceDiagram
  participant CP as 控制面(重启后)
  participant RA as ReattachService
  participant DB as sessions 表
  participant Host as 执行宿主
  participant TR as TranscriptStore

  CP->>RA: 启动钩子
  RA->>DB: 查 status IN (running, idle)
  loop 每个可恢复会话
    RA->>Host: reattach(stream_ref)
    alt 宿主/Agent 仍在
      Host-->>RA: 句柄OK
      RA->>DB: 保持 running, recoverable=true
      Note over RA,TR: 后续前端 attach?after=seq 续传
    else 宿主已消失
      RA->>TR: 读 state 目录是否可 --resume
      alt 可续跑
        RA->>Host: 重建宿主 + Agent --resume
      else 不可续跑
        RA->>DB: 标记 idle/exited(保留 transcript 只读)
      end
    end
  end
```

关键差异：现状 `reconcileRunningSessions` 是"**进程不在就判死**"；新流程是"**先尝试重连，重连不上再尝试 --resume，都不行才降级**"，且 transcript 永远保留可回看。

---

## 6. 数据模型改动（增量，不破坏现有表）

```mermaid
erDiagram
  sessions ||--|| session_streams : has
  sessions {
    text id PK
    text status "running|idle|exited|archived"
    text stream_ref "宿主重连句柄"
    boolean recoverable "重连/续跑能力"
    text state_dir_ref "NEW: Agent state 目录持久引用"
  }
  session_streams {
    text session_id PK "= sessions.id"
    integer head_seq "最大 seq(续传游标上界)"
    integer bytes "累计字节(计量/GC)"
    text storage_ref "transcript 落盘位置"
  }
```

- `sessions` 仅新增 `state_dir_ref`（可空），其余复用现有 `status/stream_ref/recoverable`。
- 新表 `session_streams` 存 transcript 元数据；帧本体在文件/对象存储。
- 迁移遵循现有 drizzle 流程，向后兼容：老会话无 transcript 时 fallback 到旧 scrollback 回放。

---

## 7. 分阶段落地（每步独立可交付）

```mermaid
flowchart LR
  P1["P1 Transcript<br/>帧格式+seq+游标重放"] --> P2["P2 State 目录持久化<br/>+ 原生 --resume 恢复"]
  P2 --> P3["P3 进程脱离<br/>reattach 契约 + ReattachService"]
  P3 --> P4["P4 休眠/唤醒<br/>空闲释放算力, 消息唤醒"]
  P4 -.可选.-> P5["P5 语义事件(A层)<br/>愿配合的 harness 才做"]
```

| 阶段 | 交付物 | 收益 | 不伤 drop-in? |
|------|--------|------|---------------|
| **P1** | `TranscriptStore` 替换 `LocalScrollbackBuffer`；WS/SSE 带 `seq` + `attach?after=` | **断线续传**、输入也入账、可完整回放 | ✅ 黑盒 |
| **P2** | runtime 声明 state 目录；随 workspace 持久化；恢复走原生 resume | 会话语义可续跑 | ✅ 黑盒 |
| **P3** | `StreamHandle.reattach`；`ReattachService` 替换"判死"逻辑；进程脱离控制面 | **控制面重启不丢会话** | ✅ 黑盒 |
| **P4** | 空闲释放算力 + 消息唤醒（Local 弱、BoxLite/K8s 强） | 成本下降，对齐 OC 休眠模型 | ✅ 黑盒 |
| **P5**（可选） | 对支持结构化输出的 harness（Claude Code `stream-json` / hooks、Codex）提取 `tool.call/message/turn.completed` | level 分层、webhook、精细 steer | ⚠️ 仅增强，不支持则 fallback P1 |

> P1–P4 全程把 Agent 当黑盒，**不牺牲"随便接流行 Agent"这个卖点**。P5 是渐进增强：能拿到多少语义就用多少，拿不到就退回字节流，不是前置门槛。

---

## 8. 与 OpenComputer 的边界对比（为什么我们不照抄）

| 维度 | OpenComputer | XEnsemble 本设计 |
|------|--------------|------------------|
| 日志位置 | **语义层**（在 Agent loop 内插桩，产结构化事件） | **传输层**（PTY 字节 + 用户输入，黑盒） |
| 代价 | 必须自写 adapter 接管每个 harness | 零侵入，任何 terminal Agent 直接跑 |
| 恢复语义 | 平台重放语义事件 + checkpoint state 目录 | Agent 原生 `--resume` + 持久 state 目录 |
| 定位契合 | 卖 webhook/多端/多 runtime | 卖"原生引入流行 Agent 的体验" |
| level 分层 / webhook | 内建 | 归入可选 P5 |

结论：OC 把日志放语义层是因为它要卖 webhook 与统一多端；XEnsemble 的定位决定日志应放**传输层**——从而**同时**拿到"可恢复"与"原生 drop-in"。

---

## 9. 待确认问题（Open Questions）

1. **Transcript 存储上限与 GC**：单会话 transcript 上限、冷数据是否离线到对象存储、归档会话保留期。
2. **Local 层进程脱离的具体形态**：detached 进程 + 常驻 agent-host，还是本机直接走 blink/BoxLite？影响 P3 工作量。
3. **State 目录的通用性**：各 harness 的 state 目录与 `--resume` 语义是否稳定、能否统一到 runtime 适配契约。
4. **幂等约束**：进程脱离 + 可重连后，"最后一轮可能重复"是否影响 PR 提交、preview 等副作用；需要在 §5 契约里明确"副作用幂等"要求。
5. **前端协议兼容**：`seq` + `attach?after=` 对现有 `docs/ApiClient.md` WS/SSE 协议的增量与向后兼容。
