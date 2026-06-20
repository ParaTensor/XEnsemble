# LLM 控制面反代（Agent ↔ Gateway）

**Agent 与 UniGateway 连接的规范设计**。实现与评审须对齐本文；系统架构上下文见 [Architecture.md](./Architecture.md)，Agent 注册与 Gateway 管理见 [agents.md](./agents.md)。

## 1. 目标

- Agent（含远端 Runtime 内进程）**不直连** UniGateway；只访问控制面公开 URL。
- UniGateway 仅监听控制面内网（默认 `127.0.0.1:8741`），由控制面反代转发；或使用外部 UniGateway（Phase 3）。
- **不依赖** K8s sidecar 或 Runtime 内嵌 Gateway。
- Gateway 模式下，Agent 进程内**不注入**平台 master key（`ugk_*`），改为**会话级 token**（`xel_*`）。

## 2. 拓扑

```
Agent（任意 Runtime）
    │  HTTPS/HTTP
    │  Authorization: Bearer xel_…
    ▼
控制面  POST /api/v1/llm/v1/chat/completions 等
    │  验 session token、查 session 状态、按 tier 限流
    │  rebind ugk_* → service_id = agentId（串行）
    │  Authorization: Bearer ugk_…（内部）
    ▼
UniGateway（本地子进程 或 LLM_GATEWAY_UPSTREAM_URL）
    ▼
OpenAI / Anthropic / …（providers 配置）
```

与 Preview 反代（`server/src/preview/gateway.js`）同一模式：对外验权、对内转发。

## 3. 对外 URL

优先级：

1. 环境变量 **`CONTROL_PLANE_PUBLIC_URL`**
2. Admin Settings → Gateway → **Control plane public URL**（`gateway_public_url`）
3. 默认 `http://127.0.0.1:${PORT}`

**Router 基址**：`{public_url}/api/v1/llm`

| 场景 | 示例 |
|------|------|
| 本机 Local | `http://127.0.0.1:3888` |
| Agent 在 Docker | `http://host.docker.internal:3000` |
| 生产 | `https://app.example.com` |

Gateway 模式 spawn 时，由 `agentEnv.js` 的 `applyGatewaySynthesis` 展开为各 CLI 所需的 `*_BASE_URL` / `*_API_KEY`（值为 `xel_*` session token）。

## 4. 控制面路由

实现：`server/src/llm/proxy.js`（`registerLlmProxy`）。

| 对外路径 | 转发至 UniGateway |
|----------|-------------------|
| `POST /api/v1/llm/v1/chat/completions` | `/v1/chat/completions` |
| `POST /api/v1/llm/v1/messages` | `/v1/messages` |
| `POST /api/v1/llm/v1/embeddings` | `/v1/embeddings` |
| `GET /api/v1/llm/health` | `/health` |

须支持 **SSE 流式**响应（`http-proxy` 透传）。

## 5. 会话 Token（`xel_`）

**签发**：`POST /api/v1/session/start`，Gateway 模式、spawn 之前（`server/src/llm/sessionToken.js`）。

JWT claims（`typ: llm_session`）：`sid`、`uid`、`pid`、`aid`、`model`（可选）、`role`（配额豁免 admin）。

**校验**：JWT 有效 + DB `sessions.status === 'running'`。

**撤销**：session 退出或 `DELETE /api/v1/sessions/:id` → `status = exited`。

## 6. 模块职责

| 模块 | 职责 |
|------|------|
| `llm/publicUrl.js` | 公开 URL / Router 基址 |
| `llm/sessionToken.js` | 签发 / 校验 `xel_` token |
| `llm/proxy.js` | 反代、鉴权、限流、审计事件 |
| `llm/gatewayUpstream.js` | 解析 UniGateway 上游地址 |
| `llm/serviceRouter.js` | 按 agentId rebind api-key service |
| `llm/agentServiceSync.js` | 同步 `unigateway.toml` services/bindings |
| `llm/quota.js` | 按 `resource_tier` 每分钟请求配额 |
| `agents/agentEnv.js` | spawn env |
| `admin/GatewaySettings.js` | `public_url`、`upstream_url` 配置 |

## 7. Phase 2（已实现）

- 反代结构化日志：`sessionId`、`userId`、`agentId`、`path`
- `events` 表写入 `llm_proxy_forward` 审计
- 按 user `resource_tier` 限流（`llm/quota.js`）
- Agent Configure 保存时同步 UniGateway `service_id = agentId` binding（`agentServiceSync.js`）
- 每次 LLM 请求前将 master api-key rebind 到对应 agent service（`serviceRouter.js`）

## 8. Phase 3（已实现）

- **外部 UniGateway**：`LLM_GATEWAY_UPSTREAM_URL` 或 Settings → **External UniGateway URL**；本地子进程可不启动
- **多控制面实例**：session 鉴权以 **DB `sessions` 为准**（非内存 SessionManager）；多实例须共享同一数据库
- Admin status 返回 `llm_proxy_url`、`control_plane_public_url`、`gateway_upstream_url`、`external_upstream`

## 9. 验收

```bash
cd server
npm test                              # 单元测试
npm run test:llm-acceptance           # 需 UniGateway 二进制 + RUN_LLM_ACCEPTANCE=1
```

验收用例（`proxy.acceptance.test.js`）：无 token 401、有效 token 转发 `/health`、session exited 401。

## 10. 与 BYOK 的关系

BYOK 模式不变：用户 Vault → spawn env，不经过 `/api/v1/llm`。仅 Gateway 模式走反代 + session token。
