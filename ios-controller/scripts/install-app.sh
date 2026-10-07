#!/usr/bin/env bash
# Build the standalone macOS app and install it to /Applications.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="iOS Controller.app"
DEST="/Applications/${APP_NAME}"

echo "========================================================"
echo "  Building ${APP_NAME}"
echo "========================================================"

if ! command -v npm >/dev/null 2>&1; then
  # Prefer project-local Node if present
  if [[ -x "$ROOT/../.tooling/node/bin/npm" ]]; then
    export PATH="$ROOT/../.tooling/node/bin:$PATH"
  elif [[ -x "$ROOT/.tooling/node/bin/npm" ]]; then
    export PATH="$ROOT/.tooling/node/bin:$PATH"
  else
    echo "ERROR: npm not found"
    exit 1
  fi
fi

npm install
npx electron-builder --mac dir

# electron-builder outputs under dist/mac or dist/mac-arm64 / dist/mac-x64
SRC=""
for candidate in \
  "$ROOT/dist/mac/${APP_NAME}" \
  "$ROOT/dist/mac-x64/${APP_NAME}" \
  "$ROOT/dist/mac-arm64/${APP_NAME}"; do
  if [[ -d "$candidate" ]]; then
    SRC="$candidate"
    break
  fi
done

if [[ -z "$SRC" ]]; then
  echo "ERROR: Built app not found under dist/"
  find "$ROOT/dist" -name "*.app" -maxdepth 3 2>/dev/null || true
  exit 1
fi

echo "Installing → ${DEST}"
# Ad-hoc sign so macOS will launch from /Applications
codesign --force --deep --sign - "$SRC" 2>/dev/null || true

if [[ -d "$DEST" ]]; then
  rm -rf "$DEST"
fi
cp -R "$SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true
codesign --force --deep --sign - "$DEST" 2>/dev/null || true

echo
echo "Installed: ${DEST}"
echo "Launch with: open -a \"iOS Controller\""
open -a "iOS Controller" || open "$DEST"
