# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE=xensemble/box-base:bookworm
FROM ${BASE_IMAGE}

ARG AGENT_ID=unknown
ARG AGENT_INSTALL="echo \"no AGENT_INSTALL provided for ${AGENT_ID}\""

ENV PATH="/usr/local/bin:/root/.local/bin:${PATH}" \
    HOME="/root"

# Run the agent install, then strip npm/build caches so they are not baked into the
# image. Leaving the npm cache in the image both bloats it and eats the VM's small
# root disk at runtime.
RUN bash -lc "${AGENT_INSTALL}" \
    && rm -rf /root/.npm /root/.cache /tmp/* /var/tmp/* 2>/dev/null || true

WORKDIR /workspace
