const { getManifest } = require('../agents/agentLifecycle');
const { RuntimeError } = require('./interfaces');

const DEFAULT_REGISTRY = 'xensemble';
const DEFAULT_BASE_IMAGE = 'xensemble/box-base:bookworm';

/**
 * Per-agent boxlite image catalog.
 * `install` runs inside the agent image build (no credentials).
 * Agents with buildable:false are skipped by the build pipeline.
 */
const AGENT_BOX_IMAGE_CATALOG = {
    'kimi-code': { tag: 'kimi-code', buildable: true },
    'claude-code': { tag: 'claude-code', buildable: true },
    'droid': {
        tag: 'droid',
        buildable: true,
        install: 'curl -fsSL https://app.factory.ai/cli | sh',
    },
    'commandcode': { tag: 'commandcode', buildable: true },
    'openclaw': { tag: 'openclaw', buildable: true },
    'opencode': {
        tag: 'opencode',
        buildable: true,
        install: 'npm install -g opencode-ai@latest',
    },
    'cline': { tag: 'cline', buildable: true },
    'codebuddy': { tag: 'codebuddy', buildable: true },
    'glm-agent': { tag: 'glm-agent', buildable: true },
    'qoder': { tag: 'qoder', buildable: true },
    'qwen-code': { tag: 'qwen-code', buildable: true },
    'minimax-cli': { tag: 'minimax-cli', buildable: true },
    'pi': { tag: 'pi', buildable: true, install: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent' },
    'github-copilot': { tag: 'github-copilot', buildable: true },
    'cursor': { buildable: false, reason: 'install script requires host-specific setup' },
    'amp': { buildable: false, reason: 'install script is host-specific' },
    'hermes': { buildable: false, reason: 'install script mutates home directory layout' },
};

function agentImageEnvKey(agentId) {
    return `BLINK_IMAGE_${String(agentId || '').toUpperCase().replace(/-/g, '_')}`;
}

function imageRegistry() {
    return (process.env.XENSEMBLE_AGENT_IMAGE_REGISTRY || DEFAULT_REGISTRY).replace(/\/$/, '');
}

function imageTagSuffix() {
    return (process.env.XENSEMBLE_AGENT_IMAGE_TAG || 'latest').trim() || 'latest';
}

function resolveBoxBaseImage() {
    const fromEnv = process.env.BLINK_BASE_IMAGE?.trim() || process.env.BLINK_IMAGE?.trim();
    return fromEnv || DEFAULT_BASE_IMAGE;
}

function resolveAgentBoxImageDefault(agentId) {
    if (!agentId) return null;

    const catalog = AGENT_BOX_IMAGE_CATALOG[agentId];
    if (catalog && catalog.buildable === false) {
        return null;
    }

    const tag = catalog?.tag || agentId;
    return `${imageRegistry()}/agent-${tag}:${imageTagSuffix()}`;
}

async function resolveBoxImage({ agentId, image } = {}) {
    if (image?.trim()) return image.trim();
    if (agentId) {
        const catalog = AGENT_BOX_IMAGE_CATALOG[agentId];
        const envOverride = process.env[agentImageEnvKey(agentId)]?.trim();
        if (envOverride) return envOverride;

        if (catalog?.buildable === false) {
            throw new RuntimeError(
                `Agent "${agentId}" is not supported on boxlite (${catalog.reason || 'no image build'})`,
                400,
            );
        }

        const { getActiveImageRef } = require('./AgentBoxImageService');
        const stored = await getActiveImageRef(agentId);
        if (stored) return stored;

        const agentImage = resolveAgentBoxImageDefault(agentId);
        if (agentImage) return agentImage;
    }
    return resolveBoxBaseImage();
}

function getAgentBoxInstallCommand(agentId) {
    const catalog = AGENT_BOX_IMAGE_CATALOG[agentId];
    if (catalog?.install) return catalog.install;
    if (catalog && catalog.buildable === false) return null;

    const manifest = getManifest(agentId);
    if (manifest.preInstall) {
        return `${manifest.preInstall} && ${manifest.install}`;
    }
    if (manifest.install) return manifest.install;
    return null;
}

function listBuildableAgentImages() {
    const { DEFAULT_AGENTS } = require('../agents/defaultAgents');
    return DEFAULT_AGENTS
        .map((agent) => agent.id)
        .filter((agentId) => {
            const catalog = AGENT_BOX_IMAGE_CATALOG[agentId];
            if (catalog?.buildable === false) return false;
            return Boolean(getAgentBoxInstallCommand(agentId));
        })
        .map((agentId) => {
            const catalog = AGENT_BOX_IMAGE_CATALOG[agentId] || {};
            return {
                agentId,
                tag: catalog.tag || agentId,
                image: resolveAgentBoxImageDefault(agentId),
                install: getAgentBoxInstallCommand(agentId),
            };
        });
}

module.exports = {
    AGENT_BOX_IMAGE_CATALOG,
    DEFAULT_BASE_IMAGE,
    agentImageEnvKey,
    imageRegistry,
    resolveBoxBaseImage,
    resolveAgentBoxImageDefault,
    resolveBoxImage,
    getAgentBoxInstallCommand,
    listBuildableAgentImages,
};
