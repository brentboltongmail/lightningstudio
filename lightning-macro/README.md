# Lightning Macro

Desktop mouse and keyboard macro recorder for macOS (and Linux). Part of Lightning Studio.

Records system-wide input with pynput, plays it back via Quartz on macOS, and runs in a pywebview window.

## Run (dev)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Grant **Accessibility** (and **Input Monitoring** if prompted) to your terminal or the app under System Settings → Privacy & Security.

## Build macOS app

```bash
./build.sh
```

Produces and installs `/Applications/LightningMacro.app`.
