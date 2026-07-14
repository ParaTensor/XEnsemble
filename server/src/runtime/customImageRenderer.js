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
  const tools = installList.filter((i) => !['agent', 'language'].includes(i.category));

  const steps = [];

  steps.push('# Base image layers');
  steps.push('# Custom image: ' + installList.map((i) => `${i.name}@${i.version}`).join(', '));
  steps.push('');

  const merged = [];

  for (const item of tools) {
    merged.push(`  echo ">>> ${item.name} ${item.version}"`);
    merged.push(`  ${item.install}`);
  }

  for (const item of langs) {
    merged.push(`  echo ">>> ${item.name} ${item.version}"`);
    merged.push(`  ${item.install}`);
  }

  for (const item of agents) {
    merged.push(`  echo ">>> ${item.name}"`);
    merged.push(`  ${item.install}`);
  }

  merged.push('  rm -rf /root/.npm /root/.cache /tmp/* /var/tmp/* 2>/dev/null; true');

  steps.push(`RUN set -eux; \\\n${merged.join(' && \\\n')}`);

  return steps.join('\n');
}

function renderDockerfile(selection) {
  const baseImage = getBaseImage();
  const installSteps = renderInstallSteps(selection);

  return `# syntax=docker/dockerfile:1.7
ARG BASE_IMAGE=${baseImage}
FROM \${BASE_IMAGE}

ENV PATH="/usr/local/bin:/root/.local/bin:/root/.cargo/bin:\${PATH}" HOME="/root"

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
