#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

echo "==> Pull latest code from GitHub"
git pull origin "$(git rev-parse --abbrev-ref HEAD)"

echo "==> Node $(cat .nvmrc)"
nvm use "$(cat .nvmrc)"

echo "==> Server dependencies"
(cd server && npm install)

echo "==> Build UniGateway"
(cd server && npm run build:gateway)

echo "==> Web admin build"
(cd client && npm install && npm run build)

echo "==> Restart control plane"
sudo systemctl daemon-reload
sudo systemctl restart xensemble

echo "==> Done"
