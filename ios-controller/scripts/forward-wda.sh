#!/usr/bin/env bash
# Forward WebDriverAgent HTTP (device :8100) to localhost:8100 over USB.
set -euo pipefail

LOCAL_PORT="${1:-8100}"
REMOTE_PORT="${2:-8100}"

echo "Forwarding localhost:${LOCAL_PORT} → device:${REMOTE_PORT}"
echo "Keep this terminal open. Test with: curl -s http://127.0.0.1:${LOCAL_PORT}/status"
echo

if command -v iproxy >/dev/null 2>&1; then
  exec iproxy "${LOCAL_PORT}" "${REMOTE_PORT}"
fi

if python3 -c "import pymobiledevice3" >/dev/null 2>&1; then
  exec python3 -m pymobiledevice3 usbmux forward "${LOCAL_PORT}" "${REMOTE_PORT}"
fi

echo "ERROR: Need iproxy (libimobiledevice) or pymobiledevice3."
echo "  brew install libimobiledevice"
echo "  pip3 install -U pymobiledevice3"
exit 1
