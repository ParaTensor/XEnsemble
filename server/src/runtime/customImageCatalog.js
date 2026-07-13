const { getAgentBoxInstallCommand } = require('./agentBoxImages');
const { AGENT_BOX_IMAGE_CATALOG } = require('./agentBoxImages');

const CATEGORY_AGENT = 'agent';
const CATEGORY_LANGUAGE = 'language';

const LANGUAGE_INSTALL = {
  python: {
    '3.11': { install: 'apt-get update && apt-get install -y python3.11 python3.11-venv python3.11-dev && rm -rf /var/lib/apt/lists/*', default: false },
    '3.12': { install: 'apt-get update && apt-get install -y python3.12 python3.12-venv python3.12-dev && rm -rf /var/lib/apt/lists/*', default: true },
    '3.13': { install: 'apt-get update && apt-get install -y python3.13 python3.13-venv python3.13-dev && rm -rf /var/lib/apt/lists/*', default: false },
  },
  go: {
    '1.21': { install: 'curl -fsSL https://go.dev/dl/go1.21.13.linux-amd64.tar.gz | tar -C /usr/local -xz && ln -sf /usr/local/go/bin/go /usr/local/bin/go && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt', default: false },
    '1.22': { install: 'curl -fsSL https://go.dev/dl/go1.22.12.linux-amd64.tar.gz | tar -C /usr/local -xz && ln -sf /usr/local/go/bin/go /usr/local/bin/go && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt', default: false },
    '1.23': { install: 'curl -fsSL https://go.dev/dl/go1.23.6.linux-amd64.tar.gz | tar -C /usr/local -xz && ln -sf /usr/local/go/bin/go /usr/local/bin/go && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt', default: true },
    '1.24': { install: 'curl -fsSL https://go.dev/dl/go1.24.0.linux-amd64.tar.gz | tar -C /usr/local -xz && ln -sf /usr/local/go/bin/go /usr/local/bin/go && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt', default: false },
  },
  java: {
    '17': { install: 'apt-get update && apt-get install -y openjdk-17-jdk-headless && rm -rf /var/lib/apt/lists/*', default: false },
    '21': { install: 'apt-get update && apt-get install -y openjdk-21-jdk-headless && rm -rf /var/lib/apt/lists/*', default: true },
    '24': { install: 'apt-get update && apt-get install -y openjdk-24-jdk-headless && rm -rf /var/lib/apt/lists/*', default: false },
  },
  nodejs: {
    '20': { install: 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*', default: false },
    '22': { install: 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*', default: true },
    '23': { install: 'curl -fsSL https://deb.nodesource.com/setup_23.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*', default: false },
  },
};

function buildCatalog() {
  const agents = Object.keys(AGENT_BOX_IMAGE_CATALOG)
    .filter((agentId) => {
      const entry = AGENT_BOX_IMAGE_CATALOG[agentId];
      if (entry.buildable === false) return false;
      return Boolean(getAgentBoxInstallCommand(agentId));
    })
    .map((agentId) => {
      const entry = AGENT_BOX_IMAGE_CATALOG[agentId];
      return {
        id: `agent:${agentId}`,
        name: entry.tag || agentId,
        category: CATEGORY_AGENT,
        versions: [{ version: 'latest', is_default: true }],
        defaultVersion: 'latest',
      };
    });

  const languages = Object.keys(LANGUAGE_INSTALL).map((langId) => {
    const versions = LANGUAGE_INSTALL[langId];
    const names = { python: 'Python', go: 'Go', java: 'Java', nodejs: 'Node.js' };
    const versionList = Object.keys(versions).map((v) => ({
      version: v,
      is_default: Boolean(versions[v].default),
    }));
    const defaultVer = versionList.find((v) => v.is_default)?.version || versionList[0]?.version;
    return {
      id: `lang:${langId}`,
      name: names[langId] || langId,
      category: CATEGORY_LANGUAGE,
      versions: versionList,
      defaultVersion: defaultVer,
    };
  });

  return [...agents, ...languages];
}

function getInstallFragment(componentId, version) {
  if (componentId.startsWith('agent:')) {
    const agentId = componentId.slice('agent:'.length);
    return getAgentBoxInstallCommand(agentId);
  }
  if (componentId.startsWith('lang:')) {
    const langId = componentId.slice('lang:'.length);
    const versions = LANGUAGE_INSTALL[langId];
    if (!versions) return null;
    const entry = versions[version];
    return entry ? entry.install : null;
  }
  return null;
}

function getCategory(componentId) {
  if (componentId.startsWith('agent:')) return CATEGORY_AGENT;
  if (componentId.startsWith('lang:')) return CATEGORY_LANGUAGE;
  return null;
}

const CUSTOM_IMAGE_CATALOG = buildCatalog();

function getCatalog() {
  return CUSTOM_IMAGE_CATALOG;
}

function getComponentById(componentId) {
  return CUSTOM_IMAGE_CATALOG.find((c) => c.id === componentId) || null;
}

function validateSelection(selection) {
  if (!Array.isArray(selection) || selection.length === 0) {
    return { ok: false, error: 'selection must be a non-empty array' };
  }

  const seen = new Set();
  const unknowns = [];
  const errors = [];

  for (let i = 0; i < selection.length; i++) {
    const item = selection[i];
    const { component_id: componentId, version } = item || {};

    if (!componentId || typeof componentId !== 'string') {
      errors.push(`selection[${i}]: component_id is required and must be a string`);
      continue;
    }
    if (!version || typeof version !== 'string') {
      errors.push(`selection[${i}]: version is required and must be a string`);
      continue;
    }
    if (
      !componentId.startsWith('agent:') && !componentId.startsWith('lang:')
    ) {
      unknowns.push(componentId);
      continue;
    }

    const component = getComponentById(componentId);
    if (!component) {
      unknowns.push(componentId);
      continue;
    }

    const validVersion = component.versions.some((v) => v.version === version);
    if (!validVersion) {
      errors.push(
        `version "${version}" is not available for component "${component.name}" (${componentId})`,
      );
      continue;
    }

    const install = getInstallFragment(componentId, version);
    if (!install) {
      errors.push(
        `no install script available for component "${component.name}" (${componentId})@${version}`,
      );
    }

    if (seen.has(componentId)) {
      errors.push(`duplicate component: "${component.name}" (${componentId})`);
    }
    seen.add(componentId);
  }

  if (unknowns.length > 0) {
    errors.push(
      `unknown component id(s): ${unknowns.join(', ')}`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, error: errors.join('; ') };
  }

  return { ok: true };
}

function selectionToInstallList(selection) {
  const result = [];
  for (const { component_id: componentId, version } of selection) {
    const install = getInstallFragment(componentId, version);
    const component = getComponentById(componentId);
    if (install) {
      result.push({
        component_id: componentId,
        name: component ? component.name : componentId,
        version,
        install,
        category: getCategory(componentId),
      });
    }
  }
  return result;
}

module.exports = {
  CATEGORY_AGENT,
  CATEGORY_LANGUAGE,
  LANGUAGE_INSTALL,
  CUSTOM_IMAGE_CATALOG,
  getCatalog,
  getComponentById,
  getInstallFragment,
  validateSelection,
  selectionToInstallList,
};
