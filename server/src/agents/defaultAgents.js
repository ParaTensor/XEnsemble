/** Built-in agent catalog — synced on DB init via INSERT OR IGNORE + UPDATE for cmd/args/env. */

const DEFAULT_AGENTS = [
    {
        id: 'kimi-code',
        name: 'Kimi Code',
        cmd: 'kimi',
        args: [],
        // Kimi Code authenticates via `kimi login` / config.toml - no BYOK env injection.
        env_required: [],
        resume: {
            level: 'L2',
            stateEnv: 'KIMI_CODE_HOME',
            resumeArgs: ['--continue'],
        },
        configSchema: {
            configFiles: [{
                path: '/root/.kimi/config.toml',
                format: 'toml',
                label: 'config.toml',
                description: 'Kimi Code 配置文件（模型、Provider、API Key）',
                example: [
                    'default_model = "kimi-k2.5"',
                    '',
                    '[providers.kimi]',
                    'type = "kimi"',
                    'base_url = "https://api.moonshot.cn/v1"',
                    'api_key = "your-api-key"',
                    '',
                    '[models.kimi-default]',
                    'provider = "kimi"',
                    'model = "kimi-k2.5"',
                    'max_context_size = 256000',
                ].join('\n'),
            }],
        },
    },
    {
        id: 'claude-code',
        name: 'Claude Code',
        cmd: 'claude',
        args: [],
        env_required: ['ANTHROPIC_API_KEY'],
        resume: {
            level: 'L2',
            stateEnv: 'CLAUDE_CONFIG_DIR',
            resumeArgs: ['--continue'],
            resumeCheckSubdir: 'projects',
        },
        configSchema: {
            configFiles: [{
                path: '${STATE_DIR}/.claude.json',
                format: 'json',
                label: '.claude.json',
                description: 'Claude Code 配置文件（权限、API Key 审批）',
                example: JSON.stringify({
                    permissions: {
                        allow: ['Bash(git:*)', 'Read(//**)'],
                        deny: [],
                    },
                }, null, 2),
            }],
        },
    },
    {
        id: 'cursor',
        name: 'Cursor Agent',
        cmd: 'agent',
        args: [],
        env_required: [],
        resume: {
            level: 'L2',
            stateEnv: 'CURSOR_DATA_DIR',
            resumeArgs: ['--continue'],
        },
    },
    {
        id: 'opencode',
        name: 'OpenCode',
        cmd: 'opencode',
        args: [],
        env_required: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
        resume: {
            level: 'L2',
            stateEnv: 'XDG_DATA_HOME',
            resumeArgs: ['--continue'],
        },
        configSchema: {
            configFiles: [{
                path: '/root/.config/opencode/opencode.json',
                format: 'json',
                label: 'opencode.json',
                description: 'OpenCode 配置文件（自动更新、模型选择等）',
                example: JSON.stringify({
                    autoupdate: false,
                    model: 'auto',
                }, null, 2),
            }],
        },
    },
    {
        id: 'amp',
        name: 'AMP',
        cmd: 'amp',
        args: [],
        env_required: ['AMP_API_KEY'],
        resume: {
            level: 'L2',
            stateEnv: 'XENSEMBLE_STATE_DIR',
            resumeArgs: ['last'],
        },
    },
    {
        id: 'cline',
        name: 'Cline',
        cmd: 'cline',
        args: [],
        env_required: ['ANTHROPIC_API_KEY'],
        resume: {
            level: 'L2',
            stateEnv: 'CLINE_DATA_DIR',
            resolveResumeArgs: async ({ exec, env, runtimeRef }) => {
                const result = await exec('cline', ['history', '--json', '--limit', '1'], env, { runtimeRef, timeoutMs: 5000 }).catch(() => null);
                if (!result?.stdout) return [];
                try {
                    const sessions = JSON.parse(result.stdout);
                    if (Array.isArray(sessions) && sessions.length > 0) {
                        const sessionId = sessions[0].sessionId || sessions[0].id;
                        if (sessionId) return ['--id', sessionId];
                    }
                } catch { /* ignore */ }
                return [];
            },
        },
    },
    {
        id: 'codebuddy',
        name: 'CodeBuddy Code',
        cmd: 'codebuddy',
        args: [],
        env_required: [],
        resume: {
            level: 'L2',
            stateEnv: 'CODEBUDDY_CONFIG_DIR',
            resumeArgs: ['--continue'],
        },
    },
    {
        id: 'droid',
        name: 'Factory Droid',
        cmd: 'droid',
        args: [],
        env_required: [],
        resume: {
            level: 'L2',
            stateEnv: 'FACTORY_HOME_OVERRIDE',
            resumeArgs: ['--resume'],
        },
    },
    {
        id: 'glm-agent',
        name: 'GLM Agent',
        cmd: 'zai',
        args: [],
        env_required: ['ZAI_API_KEY'],
        resume: {
            level: 'L2',
            redirectHome: true,
            resolveResumeArgs: async ({ exec, env, runtimeRef, stateDirPath }) => {
                const sessionsDir = `${stateDirPath}/.zai/sessions`;
                const lsResult = await exec('sh', ['-c', `ls -t "${sessionsDir}"/*.json 2>/dev/null | head -1`], env, { runtimeRef, cwd: '/', timeoutMs: 5000 }).catch(() => null);
                if (!lsResult?.stdout?.trim()) return [];
                const filePath = lsResult.stdout.trim();
                const catResult = await exec('sh', ['-c', `cat "${filePath}"`], env, { runtimeRef, cwd: '/', timeoutMs: 5000 }).catch(() => null);
                if (!catResult?.stdout) return [];
                try {
                    const session = JSON.parse(catResult.stdout);
                    if (session.metadata?.name) {
                        return ['load-session', session.metadata.name];
                    }
                } catch { /* ignore */ }
                return [];
            },
        },
        configSchema: {
            configFiles: [{
                path: '${STATE_DIR}/.zai/user-settings.json',
                format: 'json',
                label: 'user-settings.json',
                description: 'GLM Agent 配置文件（API Key、模型、监听等）',
                example: JSON.stringify({
                    baseURL: 'https://api.z.ai/api/coding/paas/v4',
                    defaultModel: 'glm-4.6',
                    models: ['glm-4.6', 'glm-4.5', 'glm-4.5-air'],
                    watchEnabled: false,
                    watchDebounceMs: 300,
                    enableHistory: true,
                    apiKey: '',
                }, null, 2),
            }],
        },
    },
    {
        id: 'qoder',
        name: 'Qoder CLI',
        cmd: 'qodercli',
        args: [],
        env_required: ['QODER_PERSONAL_ACCESS_TOKEN'],
        resume: {
            level: 'L2',
            stateArgs: ['--config-dir'],
            resumeArgs: ['--continue'],
            resumeCheckSubdir: 'logs/sessions',
        },
        configSchema: {
            configFiles: [{
                path: '${STATE_DIR}/settings.json',
                format: 'json',
                label: 'settings.json',
                description: 'Qoder CLI 配置文件（自动更新、模型、权限、Skills）',
                example: JSON.stringify({
                    general: {
                        enableAutoUpdate: false,
                    },
                    model: 'qoder-max',
                    permissions: {
                        allow: ['Bash(git:*)', 'Read(//**)'],
                        deny: [],
                    },
                    skills: {
                        loadFromAgentsDirectory: true,
                    },
                }, null, 2),
            }],
        },
    },
    {
        id: 'qwen-code',
        name: 'Qwen Code',
        cmd: 'qwen',
        args: [],
        env_required: ['DASHSCOPE_API_KEY'],
        resume: {
            level: 'L2',
            stateEnv: 'QWEN_HOME',
            resumeArgs: ['--continue'],
        },
        configSchema: {
            configFiles: [{
                path: '/root/.qwen/settings.json',
                format: 'json',
                label: 'settings.json',
                description: 'Qwen Code 配置文件（自动更新、模型等）',
                example: JSON.stringify({
                    general: {
                        enableAutoUpdate: false,
                    },
                }, null, 2),
            }],
        },
    },
    {
        id: 'minimax-cli',
        name: 'MiniMax CLI',
        cmd: 'mmx',
        args: [],
        env_required: ['MINIMAX_API_KEY'],
    },
    {
        id: 'pi',
        name: 'Pi',
        cmd: 'pi',
        args: [],
        env_required: ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
        resume: {
            level: 'L2',
            stateArgs: ['--session-dir'],
            resumeArgs: ['--continue'],
        },
        configSchema: {
            configFiles: [{
                path: '/root/.pi/agent/models.json',
                format: 'json',
                label: 'models.json',
                description: 'Pi 模型配置文件（自定义 Provider、模型、API Key）',
                example: JSON.stringify({
                    providers: {},
                }, null, 2),
            }],
        },
    },
    {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        cmd: 'copilot',
        args: [],
        env_required: [],
    },
    {
        id: 'commandcode',
        name: 'CommandCode',
        cmd: 'commandcode',
        args: [],
        env_required: ['COHERE_API_KEY'],
        resume: {
            level: 'L2',
            redirectHome: true,
            resumeArgs: ['--continue'],
        },
    },
    {
        id: 'hermes',
        name: 'Hermes',
        cmd: 'hermes',
        args: ['chat', '--ignore-user-config', '--provider', 'openrouter'],
        env_required: ['OPENROUTER_API_KEY'],
        resume: {
            level: 'L2',
            stateEnv: 'HERMES_HOME',
            resumeArgs: ['--continue'],
        },
    },
    {
        id: 'openclaw',
        name: 'OpenClaw',
        cmd: 'openclaw',
        args: [],
        env_required: ['OPENCLAW_KEY'],
        resume: {
            level: 'L2',
            stateEnv: 'OPENCLAW_STATE_DIR',
        },
        configSchema: {
            configFiles: [{
                path: '/root/.openclaw/openclaw.json',
                format: 'json',
                label: 'openclaw.json',
                description: 'OpenClaw 配置文件（模型、认证、工具等）',
                example: JSON.stringify({
                    models: {},
                    auth: {},
                    logging: {
                        level: 'info',
                    },
                }, null, 2),
            }],
        },
    },
];

module.exports = { DEFAULT_AGENTS };
