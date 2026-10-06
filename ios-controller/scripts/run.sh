#!/usr/bin/env bash
# Install deps (if needed) and launch the Electron iOS controller.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found. Install Node.js first:"
  echo "  brew install node"
  exit 1
fi

if [[ ! -d node_modules/electron ]]; then
  echo "Installing npm dependencies..."
  npm install
fi

echo "Starting iOS Screen & Macro Controller..."
exec npm start
