const { selectionToInstallList } = require('./customImageCatalog');

function getBaseImage() {
  return process.env.BLINK_BASE_IMAGE?.trim()
    || process.env.BLINK_IMAGE?.trim()
    || 'xensemble/box-base:bookworm';
}

function renderInstallSteps(selection) {
  const installList = selectionToInstallList(selection).sort(
    (a, b) => a.component_id.localeCompare(b.component_id),
  );
  const agents = installList.filter((i) => i.category === 'agent');
  const langs = installList.filter((i) => i.category === 'language');

  const steps = [];

  steps.push('# Base image layers');
  steps.push('# Custom image: ' + installList.map((i) => `${i.name}@${i.version}`).join(', '));
  steps.push('');

  steps.push('# Language / runtime installs');

  const langSteps = [];
  for (const item of langs) {
    const envPrefix = `# Install ${item.name} ${item.version}`;
    langSteps.push(envPrefix);
    langSteps.push(`RUN set -eux; ${item.install}`);
  }

  if (langSteps.length > 0) {
    steps.push(...langSteps);
    steps.push('');
  }

  steps.push('# Agent installs');

  const agentSteps = [];
  for (const item of agents) {
    const envPrefix = `# Install ${item.name}`;
    agentSteps.push(envPrefix);
    agentSteps.push(`RUN set -eux; ${item.install}`);
  }

  if (agentSteps.length > 0) {
    steps.push(...agentSteps);
    steps.push('');
  }

  steps.push('# Cleanup');
  steps.push('RUN rm -rf /root/.npm /root/.cache /tmp/* /var/tmp/* 2>/dev/null || true');

  return steps.join('\n');
}

function renderDockerfile(selection) {
  const baseImage = getBaseImage();
  const installSteps = renderInstallSteps(selection);

  return `# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE=${baseImage}
FROM \${BASE_IMAGE}

ENV PATH="/usr/local/bin:/root/.local/bin:\${PATH}" HOME="/root"

${installSteps}

WORKDIR /workspace
`;
}

function renderBuildContext(selection) {
  const dockerfile = renderDockerfile(selection);
  return { dockerfile, baseImage: getBaseImage() };
}

module.exports = {
  getBaseImage,
  renderInstallSteps,
  renderDockerfile,
  renderBuildContext,
};
