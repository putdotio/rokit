#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ENV="${ROOT_DIR}/.env"
LOCAL_ENV_OVERRIDE="${ROOT_DIR}/.env.local"
PROBE_WORK_DIR="${ROKIT_LIVE_PROBE_DIR:-${ROOT_DIR}/.rokit/live-probe}"
PROBE_APP_DIR="${PROBE_WORK_DIR}/app"
PROBE_ARTIFACT_DIR="${PROBE_WORK_DIR}/artifacts"
PROBE_ZIP="out/live-probe.zip"

load_env_file() {
  local env_file="$1"
  if [[ -f "${env_file}" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "${env_file}"
    set +a
  fi
}

load_env_file "${LOCAL_ENV}"
load_env_file "${LOCAL_ENV_OVERRIDE}"

export ROKIT_TARGET="${ROKIT_TARGET:-${ROKU_DEV_TARGET:-}}"
export ROKIT_PASSWORD="${ROKIT_PASSWORD:-${ROKU_DEV_PASSWORD:-}}"
export ROKIT_USERNAME="${ROKIT_USERNAME:-rokudev}"

if [[ -z "${ROKIT_TARGET}" ]]; then
  echo "ERROR: ROKIT_TARGET or ROKU_DEV_TARGET is not set. Add it to .env." >&2
  exit 1
fi

if [[ -z "${ROKIT_PASSWORD}" ]]; then
  echo "ERROR: ROKIT_PASSWORD or ROKU_DEV_PASSWORD is not set. Install and screenshot need Developer Mode auth." >&2
  exit 1
fi

rm -rf "${PROBE_WORK_DIR}"
mkdir -p "${PROBE_APP_DIR}" "${PROBE_ARTIFACT_DIR}"
cp -R "${ROOT_DIR}/examples/live-probe-channel/." "${PROBE_APP_DIR}/"

cd "${ROOT_DIR}"
pnpm run build
node dist/rokit.mjs check --json

cd "${PROBE_APP_DIR}"
node "${ROOT_DIR}/dist/rokit.mjs" package --out "${PROBE_ZIP}" --json

cd "${ROOT_DIR}"
node dist/rokit.mjs install "${PROBE_APP_DIR}/${PROBE_ZIP}" --json
node dist/rokit.mjs launch dev --json
node dist/rokit.mjs wait-ready dev --node title text "Rokit Live Probe" --timeout-ms 10000 --json
node dist/rokit.mjs press Info Back --delay-ms 250 --json
node dist/rokit.mjs assert-node status text "Install, launch, input, and proof OK" --json
node dist/rokit.mjs proof "${PROBE_ARTIFACT_DIR}" --screenshot --json

echo "live probe artifacts: ${PROBE_ARTIFACT_DIR}"
