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

  const steps = [];

  steps.push('# Base image layers');
  steps.push('# Custom image: ' + installList.map((i) => `${i.name}@${i.version}`).join(', '));
  steps.push('');

  // Each component is its own RUN layer so Docker can reuse
  // cached layers when the same component+version appears in a
  // different image build.
  for (const item of installList) {
    steps.push(`# ${item.name}`);
    steps.push(`RUN set -eux; \\\n  echo ">>> ${item.name} ${item.version}" && \\\n  ${item.install}`);
    steps.push('');
  }

  steps.push('# Cleanup');
  steps.push('RUN rm -rf /root/.npm /root/.cache /tmp/* /var/tmp/* 2>/dev/null; true');

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
