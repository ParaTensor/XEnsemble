# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE=xensemble/box-base:bookworm
FROM ${BASE_IMAGE}

ARG AGENT_ID=unknown
ARG AGENT_INSTALL="echo \"no AGENT_INSTALL provided for ${AGENT_ID}\""

ENV PATH="/usr/local/bin:/root/.local/bin:${PATH}" \
    HOME="/root"

RUN bash -lc "${AGENT_INSTALL}"

WORKDIR /workspace
