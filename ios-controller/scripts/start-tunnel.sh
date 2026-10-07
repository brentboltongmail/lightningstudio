#!/usr/bin/env bash
# Start the iOS USB developer tunnel (pymobiledevice3 tunneld).
# Keep this terminal open while using the controller.
set -euo pipefail

echo "========================================================"
echo "  iOS Developer Tunnel (pymobiledevice3 tunneld)"
echo "  Do NOT close this window while using the controller."
echo "========================================================"
echo

if ! python3 -c "import pymobiledevice3" >/dev/null 2>&1; then
  echo "ERROR: pymobiledevice3 not installed."
  echo "  pip3 install -U pymobiledevice3"
  exit 1
fi

# tunneld typically needs elevated privileges for the developer VPN tunnel on macOS.
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Requesting sudo for tunneld..."
  exec sudo python3 -m pymobiledevice3 remote tunneld
else
  exec python3 -m pymobiledevice3 remote tunneld
fi
