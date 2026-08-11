# BYOK 配置参数梳理

## 设计原则
- 每个 agent 只保留 4-5 个模型使用核心参数
- 去掉权限、自动更新、历史记录、日志等非核心配置
- 用户看到的是统一的 key-value 表单（不区分 env 还是配置文件）
- 每个 key 旁边有问号 tooltip 说明用途
- 后端收到值后生成对应的 env / 配置文件
- 有默认值的字段预填，用户可修改
- 必填字段标记，选填字段可留空

## 字段类型
- `string`: 普通文本输入
- `secret`: password 输入（API Key / Token）
- `number`: 数字输入

---

## 1. kimi-code（config.toml）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| api_key | API Key | Moonshot/Kimi API 密钥 | secret | - | ✅ |
| base_url | Base URL | API 基础地址 | string | https://api.moonshot.cn/v1 | |
| model | Model | 模型 ID | string | kimi-k2.5 | |
| max_context_size | Max Context Size | 最大上下文窗口（token 数） | number | 256000 | |

生成: config.toml（TOML 格式）。`default_model`/`default_provider`/`type`/`provider` 等关联字段固定写死（type="kimi"，provider="kimi"），不需要用户填写。

## 2. claude-code（env）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| ANTHROPIC_API_KEY | API Key | Anthropic API 密钥 | secret | - | ✅ |
| ANTHROPIC_BASE_URL | Base URL | API 基础地址，可填代理地址 | string | https://api.anthropic.com | |
| ANTHROPIC_MODEL | Model | 主模型 ID | string | - | |
| ANTHROPIC_SMALL_FAST_MODEL | Small/Fast Model | 轻量快速模型 ID（用于简单任务） | string | - | |

生成: env 环境变量注入。

## 3. cursor

无可配置参数（自有登录）。

## 4. opencode（opencode.json）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| apiKey | API Key | LLM Provider API 密钥 | secret | - | ✅ |
| baseURL | Base URL | API 基础地址 | string | https://api.deepseek.com | |
| model | Model | 默认模型，格式为 provider/model | string | my-deepseek/deepseek-chat | |
| provider | Provider Name | Provider 标识名 | string | my-deepseek | |

生成: opencode.json（JSON 格式），npm/name/models 等关联字段自动填充。

## 5. amp

无可配置参数（自有登录）。

## 6. cline（env）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| ANTHROPIC_API_KEY | API Key | Anthropic API 密钥 | secret | - | ✅ |

生成: env 环境变量注入。

## 7. codebuddy

无可配置参数（自有登录）。

## 8. droid（settings.json）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| apiKey | API Key | LLM Provider API 密钥 | secret | - | ✅ |
| baseUrl | Base URL | API 基础地址 | string | https://api.deepseek.com/v1 | |
| model | Model | 模型 ID | string | deepseek-chat | |
| provider | Provider Type | Provider 类型 | string | generic-chat-completion-api | |

生成: settings.json（JSON 格式），customModels 数组自动构建。

## 9. glm-agent（user-settings.json）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| apiKey | API Key | Z.AI API 密钥 | secret | - | ✅ |
| baseURL | Base URL | API 基础地址 | string | https://api.z.ai/api/coding/paas/v4 | |
| defaultModel | Model | 默认模型 ID | string | glm-4.6 | |

生成: user-settings.json（JSON 格式）。models 数组自动保留默认白名单 `["glm-4.6","glm-4.5","glm-4.5-air"]`，若 defaultModel 不在白名单中则自动追加。watchEnabled/watchDebounceMs/enableHistory 等字段使用默认值自动填充。

## 10. qoder（settings.json + env）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| QODER_PERSONAL_ACCESS_TOKEN | Access Token | Qoder 平台访问令牌 | secret | - | ✅ |
| apiKey | Provider API Key | LLM Provider API 密钥（配置文件内） | secret | - | ✅ |
| baseUrl | Base URL | API 基础地址 | string | https://api.deepseek.com | |
| model | Model | 模型 ID | string | deepseek-chat | |

生成: QODER_PERSONAL_ACCESS_TOKEN 注入 env；settings.json 内 providers 自动构建。

## 11. qwen-code（settings.json + env）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| DASHSCOPE_API_KEY | API Key | 阿里云 DashScope API 密钥（用于 Qwen 默认模型） | secret | - | ✅ |
| customApiKey | Custom Provider Key | 自定义 Provider 的 API 密钥（选填，填了则使用自定义 Provider 而非 DashScope） | secret | - | |
| baseUrl | Custom Base URL | 自定义 Provider API 基础地址（选填，配合 customApiKey 使用） | string | https://api.deepseek.com/v1 | |
| model | Custom Model | 自定义模型 ID（选填，配合 customApiKey 使用） | string | deepseek-chat | |

生成: DASHSCOPE_API_KEY 注入 env。若用户填了 customApiKey，则生成 settings.json：apiKey 直接内嵌到 JSON 的 `env` 字段和 `modelProviders` 中，不依赖环境变量引用（避免 envKey 找不到值的问题）。若未填 customApiKey 则不生成 settings.json，使用 Qwen 默认行为。

## 12. minimax-cli（env）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| MINIMAX_API_KEY | API Key | MiniMax API 密钥 | secret | - | ✅ |

生成: env 环境变量注入。

## 13. pi（models.json + env）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| ANTHROPIC_API_KEY | Anthropic API Key | Anthropic API 密钥 | secret | - | ✅ |
| OPENAI_API_KEY | OpenAI API Key | OpenAI API 密钥 | secret | - | ✅ |
| apiKey | Custom Provider Key | 自定义 Provider API 密钥（选填，用于 DeepSeek 等第三方） | secret | - | |
| baseUrl | Custom Base URL | 自定义 Provider API 地址 | string | https://api.deepseek.com/v1 | |
| model | Custom Model | 自定义模型 ID | string | deepseek-chat | |

生成: ANTHROPIC_API_KEY/OPENAI_API_KEY 注入 env。若用户填了 apiKey（自定义 Provider），则生成 models.json：apiKey 直接内嵌到 JSON 的 `providers.<name>.apiKey` 字段中，不通过 env 引用，避免与 env 注入的 key 冲突。若未填则不生成 models.json。

## 14. github-copilot

无可配置参数（GitHub OAuth 登录）。

## 15. commandcode（env）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| COHERE_API_KEY | API Key | Cohere API 密钥 | secret | - | ✅ |

生成: env 环境变量注入。

## 16. hermes（config.yaml）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| api_key | API Key | LLM Provider API 密钥 | secret | - | ✅ |
| base_url | Base URL | API 基础地址 | string | https://api.deepseek.com/v1 | |
| model | Model | 模型 ID | string | deepseek-chat | |
| api_mode | API Mode | API 协议模式 | string | openai | |

生成: config.yaml（YAML 格式），model/provider/name 等关联字段自动填充。

## 17. openclaw（openclaw.json）

| key | label | tooltip | type | 默认值 | 必填 |
|-----|-------|---------|------|--------|------|
| apiKey | API Key | LLM Provider API 密钥 | secret | - | ✅ |
| baseUrl | Base URL | API 基础地址 | string | https://api.deepseek.com/v1 | |
| model | Model | 模型 ID | string | deepseek-chat | |
| api | API Type | API 协议类型 | string | openai-completions | |

生成: openclaw.json（JSON 格式），providers/models/agents/logging 等关联字段自动填充。

---

## 汇总

| 分类 | Agent | 字段数 |
|------|-------|--------|
| 无配置 | cursor, amp, codebuddy, github-copilot | 0 |
| 仅 env（1个key） | cline, minimax-cli, commandcode | 1 |
| env + 可选配置文件 | claude-code(4), qoder(4), qwen-code(4), pi(5) | 4-5 |
| 仅配置文件 | kimi-code(4), opencode(4), droid(4), glm-agent(3), hermes(4), openclaw(4) | 3-4 |

## 实现要点

1. **前端**：用户看到统一的 key-value 表单，每个 key 旁边有问号 tooltip。必填标记 *。有默认值的预填。不区分 env 还是配置文件。
2. **后端**：收到用户填的值后，根据 agent 类型生成对应的 env 变量 + 配置文件内容。配置文件模板中的关联字段（如 provider name、npm 包名、permissions 等）自动填充默认值。
3. **选填策略**：对于有 env_required + configSchema 的 agent（claude-code/qoder/qwen-code/pi），env 字段为必填，配置文件字段为选填（留空则不生成配置文件，使用 agent 默认行为）。
4. **字段类型**：只有 string / secret / number 三种，无列表/嵌套对象。
5. **自定义 Provider apiKey 内嵌**：qwen-code 和 pi 的自定义 Provider apiKey 直接内嵌到生成的 JSON 配置文件中，不通过环境变量引用，避免 env key 找不到值或与 env 注入的 key 冲突。
6. **配置文件关联字段自动补全**：
   - kimi-code: `type="kimi"`、`default_provider="kimi"`、`default_model="kimi-default"` 固定写死
   - glm-agent: `models` 白名单保留默认值，若 `defaultModel` 不在其中则追加
   - opencode: `npm="@ai-sdk/openai-compatible"`、`name` 等固定写死
   - hermes: `provider`/`name` 等 provider 关联字段自动填充
   - openclaw: `mode="merge"`、`logging.level="info"` 等固定写死
