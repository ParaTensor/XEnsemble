#!/usr/bin/env bash
set -euo pipefail

npm ci
npm --prefix server ci
npm --prefix web ci
npm --prefix desktop ci
cargo fetch --locked --manifest-path gateway/Cargo.toml
