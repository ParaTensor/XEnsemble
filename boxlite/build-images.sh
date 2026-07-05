#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${XENSEMBLE_AGENT_IMAGE_REGISTRY:-xensemble}"
TAG="${XENSEMBLE_AGENT_IMAGE_TAG:-latest}"
BASE_IMAGE="${XENSEMBLE_BOX_BASE_IMAGE:-${REGISTRY}/box-base:bookworm}"
PUSH="${PUSH_IMAGES:-0}"

echo "Building base image: ${BASE_IMAGE}"
docker build \
  -t "${BASE_IMAGE}" \
  -f "${ROOT_DIR}/boxlite/images/base/Dockerfile" \
  "${ROOT_DIR}/boxlite/images/base"

build_agent() {
  local agent_id="$1"
  local install_cmd="$2"
  local image="${REGISTRY}/agent-${agent_id}:${TAG}"

  echo "Building agent image: ${image}"
  docker build \
    --build-arg "BASE_IMAGE=${BASE_IMAGE}" \
    --build-arg "AGENT_ID=${agent_id}" \
    --build-arg "AGENT_INSTALL=${install_cmd}" \
    -t "${image}" \
    -f "${ROOT_DIR}/boxlite/images/agent/Dockerfile" \
    "${ROOT_DIR}/boxlite/images/agent"

  if [[ "${PUSH}" == "1" ]]; then
    docker push "${image}"
  fi
}

while IFS=$'\t' read -r agent_id install_cmd; do
  [[ -z "${agent_id}" ]] && continue
  build_agent "${agent_id}" "${install_cmd}"
done < <(
  node - <<'NODE'
const { listBuildableAgentImages } = require('./server/src/runtime/agentBoxImages');
for (const entry of listBuildableAgentImages()) {
  process.stdout.write(`${entry.agentId}\t${entry.install}\n`);
}
NODE
)

if [[ "${PUSH}" == "1" ]]; then
  docker push "${BASE_IMAGE}"
fi

echo "Done. Set BLINK_BASE_IMAGE=${BASE_IMAGE} and BLINK_IMAGE_<AGENT>=${REGISTRY}/agent-<id>:${TAG} as needed."
