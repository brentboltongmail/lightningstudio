#!/usr/bin/env bash
# Verify macOS prerequisites for the iOS Screen & Macro Controller.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
WARN=0

ok()   { echo "  ✅ $1"; PASS=$((PASS + 1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN + 1)); }

echo "========================================================"
echo " iOS Controller — macOS setup check"
echo " Project: $ROOT"
echo "========================================================"
echo

echo "[1] Command Line Tools / compilers"
if command -v clang >/dev/null 2>&1; then ok "clang: $(clang --version | head -1)"; else bad "clang missing (install Xcode CLT)"; fi
if command -v git >/dev/null 2>&1; then ok "git: $(git --version)"; else bad "git missing"; fi
if command -v python3 >/dev/null 2>&1; then ok "python3: $(python3 --version)"; else bad "python3 missing"; fi

echo
echo "[2] pymobiledevice3"
if python3 -m pymobiledevice3 version >/dev/null 2>&1 || python3 -c "import pymobiledevice3" >/dev/null 2>&1; then
  ok "pymobiledevice3 importable via python3"
else
  bad "pymobiledevice3 not installed (pip3 install -U pymobiledevice3)"
fi

echo
echo "[3] Xcode"
if [[ -d /Applications/Xcode.app ]]; then
  ok "Xcode.app present"
  if command -v xcodebuild >/dev/null 2>&1; then
    ok "xcodebuild: $(xcodebuild -version 2>/dev/null | tr '\n' ' ')"
  else
    warn "xcodebuild not on PATH — run: sudo xcode-select -s /Applications/Xcode.app"
  fi
elif [[ -d /Applications/Xcode.appdownload ]]; then
  warn "Xcode still downloading (/Applications/Xcode.appdownload)"
else
  bad "Xcode.app not found — install from Mac App Store"
fi

echo
echo "[4] Node.js / npm (Electron UI)"
if command -v node >/dev/null 2>&1; then ok "node: $(node --version)"; else bad "node missing — brew install node (or use nvm)"; fi
if command -v npm >/dev/null 2>&1; then ok "npm: $(npm --version)"; else bad "npm missing"; fi
if [[ -d "$ROOT/node_modules/electron" ]]; then
  ok "electron installed in ios-controller/node_modules"
else
  warn "electron not installed yet — run: cd ios-controller && npm install"
fi

echo
echo "[5] iPhone / usbmuxd"
if command -v idevice_id >/dev/null 2>&1; then
  DEVICES="$(idevice_id -l 2>/dev/null || true)"
  if [[ -n "$DEVICES" ]]; then ok "libimobiledevice sees device(s): $DEVICES"; else warn "idevice_id found but no device listed"; fi
else
  warn "idevice_id not installed (optional; brew install libimobiledevice)"
fi

if python3 -m pymobiledevice3 usbmux list >/dev/null 2>&1; then
  LIST="$(python3 -m pymobiledevice3 usbmux list 2>/dev/null || true)"
  if [[ -n "$LIST" && "$LIST" != "[]" && "$LIST" != "{}" ]]; then
    ok "pymobiledevice3 usbmux list returned device data"
  else
    warn "No USB iPhone detected — plug in, Trust This Computer, enable Developer Mode"
  fi
else
  warn "Could not query usbmux list (tunnel/daemon may need sudo on some setups)"
fi

echo
echo "[6] WebDriverAgent project"
if [[ -d "$ROOT/WebDriverAgent" ]]; then
  ok "WebDriverAgent cloned at ios-controller/WebDriverAgent"
else
  warn "WebDriverAgent not cloned — run: ./scripts/deploy-wda.sh"
fi

echo
echo "========================================================"
echo " Results: $PASS ok · $WARN warnings · $FAIL failures"
echo "========================================================"

if [[ $FAIL -gt 0 ]]; then
  echo
  echo "Next actions:"
  echo "  1. Finish Xcode install from App Store, then: sudo xcodebuild -license accept"
  echo "  2. Install Node: brew install node"
  echo "  3. Connect iPhone (Trust + Developer Mode)"
  echo "  4. ./scripts/deploy-wda.sh"
  echo "  5. ./scripts/start-tunnel.sh   (keep open)"
  echo "  6. ./scripts/run.sh"
  exit 1
fi

echo
echo "Ready for remaining steps:"
echo "  ./scripts/deploy-wda.sh     # sign & install WDA"
echo "  ./scripts/start-tunnel.sh   # keep USB developer tunnel up"
echo "  ./scripts/run.sh            # launch Electron controller"
exit 0
