/**
 * Write agent-specific config files in gateway mode so the agent's LLM
 * requests are routed through the platform gateway (UniGateway).
 *
 * Only runs when authMode === 'gateway'.  BYOK mode is never affected.
 */

const GATEWAY_CONFIG_AGENTS = new Set([
    'qwen-code',
    'droid',
    'qoder',
    'openclaw',
    'minimax-cli',
    'pi',
    'cline',
]);

function buildGatewayConfigSpec(agentId, { stateDirPath, sessionToken, routerUrl, modelTarget }) {
    switch (agentId) {
        case 'qwen-code':
            return {
                dirPath: stateDirPath,
                filePath: `${stateDirPath}/settings.json`,
                content: JSON.stringify({
                    general: { enableAutoUpdate: false },
                    model: { name: modelTarget },
                    modelProviders: {
                        gateway: [{
                            id: modelTarget,
                            baseUrl: `${routerUrl}/v1`,
                            envKey: 'OPENAI_API_KEY',
                            generationConfig: { contextWindowSize: 64000 },
                        }],
                    },
                    providerProtocol: { gateway: 'openai' },
                    security: { auth: { selectedType: 'openai' } },
                }, null, 2),
            };

        case 'droid':
            return {
                dirPath: `${stateDirPath}/.factory`,
                filePath: `${stateDirPath}/.factory/settings.json`,
                content: JSON.stringify({
                    customModels: [{
                        provider: 'generic-chat-completion-api',
                        model: modelTarget,
                        baseUrl: `${routerUrl}/v1`,
                        apiKey: sessionToken,
                    }],
                }, null, 2),
            };

        case 'qoder':
            return {
                dirPath: stateDirPath,
                filePath: `${stateDirPath}/settings.json`,
                content: JSON.stringify({
                    general: { enableAutoUpdate: false },
                    model: `gateway/${modelTarget}`,
                    providers: {
                        gateway: {
                            baseUrl: routerUrl,
                            apiKey: sessionToken,
                            displayName: 'XEnsemble Gateway',
                            model: modelTarget,
                            type: 'openai-compatible',
                            contextWindow: 64000,
                            maxOutputTokens: 8192,
                            models: [{
                                model: modelTarget,
                                displayName: modelTarget,
                                contextWindow: 64000,
                                maxOutputTokens: 8192,
                            }],
                        },
                    },
                }, null, 2),
            };

        case 'openclaw':
            return {
                dirPath: stateDirPath,
                filePath: `${stateDirPath}/openclaw.json`,
                content: JSON.stringify({
                    logging: { level: 'info' },
                    agents: {
                        defaults: {
                            model: { primary: `gateway/${modelTarget}` },
                        },
                    },
                    models: {
                        mode: 'merge',
                        providers: {
                            gateway: {
                                baseUrl: `${routerUrl}/v1`,
                                apiKey: sessionToken,
                                api: 'openai-completions',
                                models: [{
                                    id: modelTarget,
                                    name: modelTarget,
                                }],
                            },
                        },
                    },
                }, null, 2),
            };

        case 'minimax-cli':
            return {
                dirPath: null,
                filePath: '$HOME/.mmx/config.json',
                content: JSON.stringify({
                    api_key: sessionToken,
                    base_url: routerUrl,
                }, null, 2),
            };

        case 'pi':
            return {
                dirPath: '$HOME/.pi/agent',
                filePath: '$HOME/.pi/agent/models.json',
                content: JSON.stringify({
                    providers: {
                        gateway: {
                            baseUrl: `${routerUrl}/v1`,
                            api: 'openai-completions',
                            apiKey: sessionToken,
                            models: [{
                                id: modelTarget,
                                name: modelTarget,
                                contextWindow: 64000,
                            }],
                        },
                    },
                }, null, 2),
            };
        case 'cline':
            // cline reads provider config from ${CLINE_DATA_DIR}/settings/providers.json.
            // Default provider is "cline" (cline's own API); must override the
            // "openai-compatible" provider to point at the gateway, otherwise
            // cline requests go to api.openai.com and reject the session token.
            return {
                dirPath: `${stateDirPath}/settings`,
                filePath: `${stateDirPath}/settings/providers.json`,
                content: JSON.stringify({
                    version: 1,
                    lastUsedProvider: 'openai-compatible',
                    providers: {
                        'openai-compatible': {
                            settings: {
                                provider: 'openai-compatible',
                                model: modelTarget,
                                baseUrl: `${routerUrl}/v1`,
                                apiKey: sessionToken,
                            },
                            updatedAt: new Date().toISOString(),
                            tokenSource: 'manual',
                        },
                    },
                }, null, 2),
            };

        default:
            return null;
    }
}

function buildWriteScript(spec) {
    const encoded = Buffer.from(spec.content, 'utf8').toString('base64');
    const lines = ['set -e'];
    if (spec.dirPath && spec.dirPath.includes('$')) {
        lines.push(`mkdir -p "${spec.dirPath}"`);
    } else if (spec.dirPath) {
        lines.push(`mkdir -p '${spec.dirPath.replace(/'/g, "'\\''")}'`);
    } else {
        lines.push('mkdir -p "$HOME/.mmx"');
    }
    if (spec.filePath.includes('$')) {
        lines.push(`printf '%s' ${JSON.stringify(encoded)} | base64 -d > "${spec.filePath}"`);
    } else {
        lines.push(`printf '%s' ${JSON.stringify(encoded)} | base64 -d > '${spec.filePath.replace(/'/g, "'\\''")}'`);
    }
    return lines.join('\n');
}

async function ensureGatewayConfig({ runtime, runtimeRef, agentId, authMode, stateDirPath, sessionToken, routerUrl, modelTarget, warn }) {
    if (authMode !== 'gateway') {
        return { skipped: true, reason: 'not_gateway' };
    }
    if (!GATEWAY_CONFIG_AGENTS.has(agentId)) {
        return { skipped: true, reason: 'no_config_needed' };
    }
    if (!sessionToken || !routerUrl || !modelTarget) {
        return { skipped: true, reason: 'no_gateway_credentials' };
    }
    if (!runtime?.exec?.exec) {
        return { skipped: true, reason: 'no_runtime_exec' };
    }
    // minimax-cli and pi use $HOME (no state dir); all others require a state dir path.
    if (agentId !== 'minimax-cli' && agentId !== 'pi' && !stateDirPath) {
        return { skipped: true, reason: 'no_state_dir' };
    }

    const spec = buildGatewayConfigSpec(agentId, { stateDirPath, sessionToken, routerUrl, modelTarget });
    if (!spec) {
        return { skipped: true, reason: 'no_config_needed' };
    }

    const script = buildWriteScript(spec);

    try {
        const result = await runtime.exec.exec(
            'sh',
            ['-lc', script],
            {},
            { runtimeRef, cwd: '/' },
        );
        if (result.exitCode !== 0) {
            const message = `gateway config bootstrap failed with exit ${result.exitCode}`;
            warn?.(message);
            return { skipped: false, ok: false, error: message };
        }
        return { skipped: false, ok: true };
    } catch (err) {
        const message = err?.message || 'gateway config bootstrap failed';
        warn?.(message);
        return { skipped: false, ok: false, error: message };
    }
}

module.exports = {
    ensureGatewayConfig,
    GATEWAY_CONFIG_AGENTS,
    buildGatewayConfigSpec,
};
