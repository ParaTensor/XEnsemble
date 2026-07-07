# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (glibc) for npm-based agent CLIs (kimi-code requires >=22.19).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/bin:/usr/bin:/bin:${PATH}" \
    HOME="/root"

WORKDIR /workspace
RUN mkdir -p /workspace
