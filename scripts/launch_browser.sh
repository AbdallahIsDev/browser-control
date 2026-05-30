#!/usr/bin/env bash
# Browser Control — cross-platform Chrome launcher (Linux/macOS)
# Usage: ./scripts/launch_browser.sh [port] [bindAddress]

set -euo pipefail

PORT="${1:-${BROWSER_DEBUG_PORT:-9222}}"
BIND_ADDRESS="${2:-${BROWSER_BIND_ADDRESS:-127.0.0.1}}"

if [[ "${BIND_ADDRESS}" == "0.0.0.0" || "${BIND_ADDRESS}" == "::" ]]; then
  if [[ "${BROWSER_ALLOW_REMOTE_CDP:-}" != "1" ]]; then
    echo "Error: Refusing unsafe Chrome CDP bind address ${BIND_ADDRESS}. Use 127.0.0.1 or set BROWSER_ALLOW_REMOTE_CDP=1 to expose CDP beyond this machine." >&2
    exit 1
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node &>/dev/null; then
  echo "Error: Node.js not found. Install Node.js first." >&2
  exit 1
fi

exec node "${SCRIPT_DIR}/launch_browser.cjs" "$PORT" "$BIND_ADDRESS"
