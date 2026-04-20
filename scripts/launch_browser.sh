#!/usr/bin/env bash
# Browser Control — cross-platform Chrome launcher (Linux/macOS)
# Usage: ./scripts/launch_browser.sh [port] [bindAddress]

set -euo pipefail

PORT="${1:-${BROWSER_DEBUG_PORT:-9222}}"
BIND_ADDRESS="${2:-${BROWSER_BIND_ADDRESS:-127.0.0.1}}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node &>/dev/null; then
  echo "Error: Node.js not found. Install Node.js first." >&2
  exit 1
fi

exec node "${SCRIPT_DIR}/launch_browser.cjs" "$PORT" "$BIND_ADDRESS"
