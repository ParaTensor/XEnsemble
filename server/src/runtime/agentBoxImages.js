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
    // engines: >=22.19.0 — uses RegExp /v flag, requires Node.js 22+
    'kimi-code': { tag: 'kimi-code', buildable: true, minNodeVersion: '22' },
    // engines: >=22.0.0
    'claude-code': { tag: 'claude-code', buildable: true, minNodeVersion: '22' },
    'droid': {
        tag: 'droid',
        buildable: true,
        install: 'curl -fsSL https://app.factory.ai/cli | sh',
    },
    // effective >=20 (ink@6 dep requires node >=20)
    'commandcode': { tag: 'commandcode', buildable: true, minNodeVersion: '20' },
    // engines: >=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0
    'openclaw': { tag: 'openclaw', buildable: true, minNodeVersion: '22' },
    'opencode': {
        tag: 'opencode',
        buildable: true,
        // opencode-ai's postinstall installs the platform binary (glibc opencode-linux-x64)
        // and hard-links it into bin/opencode.exe. We drop the redundant "baseline" CPU
        // variant (~180MB, only needed for very old CPUs) to keep the image small — the VM
        // root disk is tight and a bloated image leaves no room for runtime data.
        install: 'npm install -g opencode-ai@latest && rm -rf "$(npm root -g)/opencode-ai/node_modules/opencode-linux-x64-baseline"',
    },
    // prebuilt standalone binary — no Node.js version requirement
    'cline': { tag: 'cline', buildable: true },
    // no engines field — skip
    'codebuddy': { tag: 'codebuddy', buildable: true },
    // engines: >=18.0.0
    'glm-agent': { tag: 'glm-agent', buildable: true, minNodeVersion: '18' },
    // engines: >=20.0.0
    'qoder': { tag: 'qoder', buildable: true, minNodeVersion: '20' },
    // engines: >=22.0.0
    'qwen-code': { tag: 'qwen-code', buildable: true, minNodeVersion: '22' },
    // engines: >=18
    'minimax-cli': { tag: 'minimax-cli', buildable: true, minNodeVersion: '18' },
    // engines: >=22.19.0
    'pi': { tag: 'pi', buildable: true, minNodeVersion: '22', install: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent' },
    // prebuilt standalone binary — no Node.js version requirement
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
        let stored = null;
        try {
            stored = await getActiveImageRef(agentId);
        } catch (_) {
            // DB unavailable (e.g. unit test without test DB) - fall back to default
        }
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
