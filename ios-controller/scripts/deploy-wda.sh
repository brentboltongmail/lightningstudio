#!/usr/bin/env bash
# Clone, sign-prep, and optionally build/install WebDriverAgent on a connected iPhone.
#
# Usage:
#   ./scripts/deploy-wda.sh              # clone + open Xcode for signing
#   ./scripts/deploy-wda.sh --build      # also xcodebuild (needs TEAM_ID)
#   TEAM_ID=XXXXXXXXXX ./scripts/deploy-wda.sh --build
#
# Free Apple ID: open the project in Xcode once, pick your Personal Team on
# WebDriverAgentRunner, then re-run with --build or use Product > Test.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WDA_DIR="$ROOT/WebDriverAgent"
WDA_REPO="${WDA_REPO:-https://github.com/appium/WebDriverAgent.git}"
BUNDLE_ID="${WDA_BUNDLE_ID:-com.facebook.WebDriverAgentRunner.xctrunner}"
DO_BUILD=0
DO_OPEN=1

for arg in "$@"; do
  case "$arg" in
    --build) DO_BUILD=1 ;;
    --no-open) DO_OPEN=0 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
  esac
done

echo "========================================================"
echo "  WebDriverAgent deploy helper"
echo "========================================================"
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: WDA signing/install requires macOS + Xcode."
  exit 1
fi

if [[ ! -d /Applications/Xcode.app ]]; then
  echo "ERROR: /Applications/Xcode.app not found."
  echo "  Wait for the App Store download to finish, open Xcode once, then retry."
  exit 1
fi

# Ensure active developer directory points at full Xcode
if ! xcode-select -p 2>/dev/null | grep -q Xcode.app; then
  echo "Selecting Xcode developer directory (sudo)..."
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
fi

if [[ ! -d "$WDA_DIR/.git" ]]; then
  echo "Cloning WebDriverAgent → $WDA_DIR"
  git clone --depth 1 "$WDA_REPO" "$WDA_DIR"
else
  echo "WebDriverAgent already present at $WDA_DIR"
fi

cd "$WDA_DIR"

# Bootstrap Carthage / dependencies when the project provides the script
if [[ -f ./Scripts/bootstrap.sh ]]; then
  echo "Running WebDriverAgent bootstrap..."
  bash ./Scripts/bootstrap.sh || warn_bootstrap=1
  if [[ "${warn_bootstrap:-0}" -eq 1 ]]; then
    echo "WARNING: bootstrap reported errors; continuing (newer WDA may use SPM)."
  fi
fi

PROJECT=""
if [[ -d WebDriverAgent.xcodeproj ]]; then
  PROJECT="WebDriverAgent.xcodeproj"
elif [[ -d WebDriverAgent.xcworkspace ]]; then
  PROJECT="WebDriverAgent.xcworkspace"
fi

if [[ -z "$PROJECT" ]]; then
  echo "ERROR: Could not find WebDriverAgent.xcodeproj in $WDA_DIR"
  exit 1
fi

echo
echo "Signing checklist (free Apple ID works):"
echo "  1. Xcode will open the WebDriverAgent project."
echo "  2. Select the WebDriverAgentRunner target."
echo "  3. Signing & Capabilities → Team → your Apple ID (Personal Team)."
echo "  4. Plug in the iPhone, Trust This Computer, enable Developer Mode."
echo "  5. Product → Destination → your iPhone → Product → Test"
echo "     (or re-run: TEAM_ID=... ./scripts/deploy-wda.sh --build)"
echo

if [[ "$DO_OPEN" -eq 1 ]]; then
  open "$WDA_DIR/$PROJECT"
fi

# Detect UDID for optional CLI build
UDID="${DEVICE_UDID:-}"
if [[ -z "$UDID" ]] && command -v xcrun >/dev/null 2>&1; then
  # Prefer a connected physical iPhone (skip Simulator lines)
  UDID="$(xcrun xctrace list devices 2>/dev/null \
    | grep -E 'iPhone|iPad' \
    | grep -vi Simulator \
    | sed -n 's/.*(\([0-9A-Fa-f-]\{20,\}\)).*/\1/p' \
    | head -1 || true)"
fi
if [[ -z "$UDID" ]] && python3 -c "import pymobiledevice3" >/dev/null 2>&1; then
  UDID="$(python3 - <<'PY' 2>/dev/null || true
import json, re, subprocess, sys
try:
    raw = subprocess.check_output(
        [sys.executable, "-m", "pymobiledevice3", "usbmux", "list"],
        text=True, stderr=subprocess.DEVNULL,
    ).strip()
except Exception:
    sys.exit(0)
if not raw:
    sys.exit(0)
try:
    data = json.loads(raw)
except Exception:
    m = re.search(r"[0-9A-Fa-f-]{20,}", raw)
    print(m.group(0) if m else "")
    sys.exit(0)
if isinstance(data, dict):
    for k, v in data.items():
        if isinstance(k, str) and len(k) >= 20:
            print(k)
            break
        if isinstance(v, dict):
            print(v.get("UniqueDeviceID") or v.get("udid") or "")
            break
elif isinstance(data, list) and data:
    item = data[0]
    if isinstance(item, dict):
        print(item.get("UniqueDeviceID") or item.get("udid") or "")
PY
)"
fi

if [[ "$DO_BUILD" -eq 1 ]]; then
  if [[ -z "${TEAM_ID:-}" ]]; then
    echo "ERROR: --build requires TEAM_ID (10-char Apple Team ID from Xcode → Settings → Accounts)."
    echo "  Example: TEAM_ID=ABCD123456 ./scripts/deploy-wda.sh --build"
    exit 1
  fi
  if [[ -z "$UDID" ]]; then
    echo "ERROR: No connected iPhone UDID found. Plug in the device and Trust This Computer."
    exit 1
  fi

  echo "Building & running WebDriverAgentRunner on device $UDID (Team $TEAM_ID)..."
  SCHEME="WebDriverAgentRunner"
  DEST="id=$UDID"

  if [[ "$PROJECT" == *.xcworkspace ]]; then
    xcodebuild -workspace "$PROJECT" -scheme "$SCHEME" -destination "$DEST" \
      DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_IDENTITY="Apple Development" \
      PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" test
  else
    xcodebuild -project "$PROJECT" -scheme "$SCHEME" -destination "$DEST" \
      DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_IDENTITY="Apple Development" \
      PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" test
  fi
fi

echo
echo "After WDA is running on the phone, forward port 8100:"
echo "  # Terminal A (keep open):"
echo "  ./scripts/start-tunnel.sh"
echo
echo "  # Terminal B — forward WDA HTTP:"
echo "  python3 -m pymobiledevice3 usbmux forward 8100 8100"
echo "  # or: iproxy 8100 8100"
echo
echo "  # Verify:"
echo "  curl -s http://127.0.0.1:8100/status | head"
echo
echo "  # Launch controller:"
echo "  ./scripts/run.sh"
