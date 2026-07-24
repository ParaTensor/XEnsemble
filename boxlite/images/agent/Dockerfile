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
RUN bash -lc "${AGENT_INSTALL}" \
    && rm -rf /root/.npm /root/.cache /tmp/* /var/tmp/* 2>/dev/null || true \
    && find /usr/lib/node_modules -path "*/prebuilds/win32-*" -prune -exec rm -rf {} + 2>/dev/null || true \
    && find /usr/lib/node_modules -path "*/prebuilds/darwin-*" -prune -exec rm -rf {} + 2>/dev/null || true \
    && find /usr/lib/node_modules -name "*.pdb" -delete 2>/dev/null || true \
    && find /usr/lib/node_modules -maxdepth 4 -type d -name '.*-*' -exec rm -rf {} + 2>/dev/null || true \
    && mkdir -p /root/.config/opencode /root/.qwen \
    && echo '{"autoupdate":false}' > /root/.config/opencode/opencode.json \
    && echo '{"general":{"enableAutoUpdate":false}}' > /root/.qwen/settings.json \
    && true

WORKDIR /workspace
