# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE=xensemble/box-base:bookworm
FROM ${BASE_IMAGE}

ARG AGENT_ID=unknown
ARG AGENT_INSTALL="echo \"no AGENT_INSTALL provided for ${AGENT_ID}\""

ENV PATH="/usr/local/bin:/root/.local/bin:${PATH}" \
    HOME="/root" \
    KIMI_CODE_NO_AUTO_UPDATE=1 \
    DISABLE_UPDATES=1 \
    FACTORY_DROID_AUTO_UPDATE_ENABLED=false \
    OPENCLAW_NO_AUTO_UPDATE=1

# Install the agent CLI, then strip everything that is not needed at runtime.
# The VM root disk (vda) is tight (typically 639MB for agent images), so every
# byte saved here is critical for session stability.
# Source maps (*.map), test files, and docs are removed to reduce inode count
# (mke2fs has a default inode ratio that large node_modules can exceed).
# NOTE: *.md and examples/*.ts are NOT removed from dist/bundled/ because some
# agents (e.g. command-code) ship runtime skill assets (SKILL.md, examples).
# NOTE: *.md in templates/ directories are preserved because some agents
# (e.g. openclaw) load workspace templates (AGENTS.md, BOOT.md, etc.) at runtime.
RUN bash -lc "${AGENT_INSTALL}" \
    && rm -rf /root/.npm /root/.cache /tmp/* /var/tmp/* 2>/dev/null || true \
    && find /usr/lib/node_modules -path "*/prebuilds/win32-*" -prune -exec rm -rf {} + 2>/dev/null || true \
    && find /usr/lib/node_modules -path "*/prebuilds/darwin-*" -prune -exec rm -rf {} + 2>/dev/null || true \
    && find /usr/lib/node_modules -name "*.pdb" -delete 2>/dev/null || true \
    && find /usr/lib/node_modules -name "*.map" -not -path "*/dist/bundled/*" -delete 2>/dev/null || true \
    && find /usr/lib/node_modules -type d \( -name "__tests__" -o -name "__test__" -o -name "__snapshots__" -o -name "test" -o -name "tests" -o -name "testdata" \) -not -path "*/dist/bundled/*" -exec rm -rf {} + 2>/dev/null || true \
    && find /usr/lib/node_modules -type d \( -name "examples" -o -name "bench" -o -name "benchmarks" \) -not -path "*/dist/bundled/*" -exec rm -rf {} + 2>/dev/null || true \
    && find /usr/lib/node_modules -type f \( -name "*.md" -o -name "*.markdown" -o -name "*.ts" -o -name "*.tsx" -o -name "*.coffee" -o -name "LICENSE*" -o -name "CHANGELOG*" \) -not -path "*/dist/bundled/*" -not -path "*/templates/*" -delete 2>/dev/null || true \
    && find /usr/lib/node_modules -maxdepth 4 -type d -name '.*-*' -exec rm -rf {} + 2>/dev/null || true \
    && mkdir -p /root/.config/opencode /root/.qwen \
    && echo '{"autoupdate":false}' > /root/.config/opencode/opencode.json \
    && echo '{"general":{"enableAutoUpdate":false}}' > /root/.qwen/settings.json \
    && true

WORKDIR /workspace
