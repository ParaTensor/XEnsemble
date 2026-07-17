# syntax=docker/dockerfile:1.7

FROM debian:bookworm-slim

ARG DEBIAN_FRONTEND=noninteractive

# Common dev tools needed by every agent shell: git (HTTPS) + openssh-client
# (git over SSH), less (pager for git log/man), vim-tiny (editor), make/unzip/file
# (build & archive helpers). gh is installed in a dedicated layer below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
        less \
        openssh-client \
        vim-tiny \
        make \
        unzip \
        file \
    && update-alternatives --install /usr/bin/vim vim /usr/bin/vim.tiny 10 \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (glibc) for npm-based agent CLIs (kimi-code requires >=22.19).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# GitHub CLI (gh) - not shipped in Debian bookworm; use the official apt source.
RUN mkdir -p -m 755 /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/bin:/usr/bin:/bin:${PATH}" \
    HOME="/root"

WORKDIR /workspace
RUN mkdir -p /workspace
