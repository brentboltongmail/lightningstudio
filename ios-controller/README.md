# iOS Screen & Macro Controller

Electron desktop app that **mirrors an iPhone over USB**, maps mouse clicks/drags to native taps/swipes, and **records looping macros**.

Primary target host: **macOS (MacBook Air)** with Xcode + WebDriverAgent. Windows helpers (`.bat` / `.ps1`) remain for the older Bluetooth-mouse path.

---

## Architecture

```text
MacBook                          iPhone (USB)
┌─────────────────────────┐      ┌──────────────────────────┐
│ Electron UI             │──────│ WebDriverAgent (Runner)  │
│ Screen stream / macros  │ :8100│ → native touch events    │
│ pymobiledevice3 tunnel  │◄─────│ display buffer / DVT     │
│ Xcode signs & deploys   │      └──────────────────────────┘
└─────────────────────────┘
```

| Piece | Role |
| :--- | :--- |
| **Electron app** (`npm start`) | UI, coordinate mapping, macro record/replay |
| **pymobiledevice3** | USB tunnel (`tunneld`) + optional screenshots / port forward |
| **WebDriverAgent** | On-device HTTP API for taps/swipes (`localhost:8100`) |
| **Xcode** | Build & sign WDA with your Apple ID |

---

## Setup progress (Mac)

| Phase | Description | Status |
| :--- | :--- | :---: |
| 1. Repo | Clone `lightningstudio` | ✅ |
| 2. CLI tools | `clang`, `git`, `python3` | ✅ |
| 3. Python tools | `pymobiledevice3` on PATH | ✅ |
| 4. Xcode | Full `Xcode.app` from App Store | ⏳ |
| 5. Node.js | Runtime for Electron | 📋 |
| 6. Device trust | USB Trust + Developer Mode | 📋 |
| 7. Deploy WDA | Sign & install WebDriverAgent | 📋 |
| 8. Launch | `./scripts/run.sh` + test macros | 📋 |

---

## Quick start (macOS)

### 1. Finish Xcode

When `/Applications/Xcode.appdownload` finishes:

```bash
# Open Xcode once to complete install, then:
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

### 2. Install Node.js

```bash
brew install node
# or: nvm install --lts
```

### 3. Connect the iPhone

1. USB cable → tap **Trust This Computer**
2. **Settings → Privacy & Security → Developer Mode → On** (reboot)
3. Keep the phone unlocked while deploying WDA the first time

### 4. Check prerequisites

```bash
cd ios-controller
chmod +x scripts/*.sh
./scripts/check-setup.sh
```

### 5. Deploy WebDriverAgent

```bash
./scripts/deploy-wda.sh
```

In Xcode: select **WebDriverAgentRunner** → **Signing** → your **Personal Team** → destination = your iPhone → **Product → Test**.

Optional CLI build (after you know your 10-char Team ID):

```bash
TEAM_ID=XXXXXXXXXX ./scripts/deploy-wda.sh --build
```

### 6. Tunnel + port forward (two terminals)

```bash
# Terminal A — developer tunnel (keep open; asks for sudo)
./scripts/start-tunnel.sh

# Terminal B — WDA HTTP on localhost:8100
./scripts/forward-wda.sh
```

Verify:

```bash
curl -s http://127.0.0.1:8100/status
```

### 7. Launch the controller

```bash
./scripts/run.sh
# equivalent: npm install && npm start
```

In the app: confirm WDA URL `http://127.0.0.1:8100` → **Connect** → use **Auto Stream** / **Snapshot**, then record macros.

---

## npm scripts

| Script | What it does |
| :--- | :--- |
| `npm start` | Launch Electron |
| `npm run check-setup` | Prerequisite checklist |
| `npm run deploy-wda` | Clone/open WDA for signing |
| `npm run tunnel` | Start `pymobiledevice3` tunneld |
| `npm run forward-wda` | Forward device `:8100` → localhost |
| `npm run run:mac` | Install deps if needed + start |

---

## Features

- **Coordinate mapping** — mouse on the mirror → native iPhone points (presets for Pro / Max / SE sizes)
- **Macro recorder** — taps & swipes with timing; loop N times or infinitely; export/import `.json`
- **Visual feedback** — touch ripples + live coordinate readout
- **Dual execution** — WebDriverAgent over USB, with simulation fallback when WDA is offline
- **Optional BT mouse path** — Windows AssistiveTouch HID helpers (`bt_mouse_service.py`) still present

---

## Windows notes

Older Windows workflow used iTunes USB drivers, `start-tunnel.bat`, and Bluetooth mouse injection. Prefer macOS + WDA for reliable native touch injection. If you stay on Windows:

1. Enable Developer Mode on the iPhone  
2. Install Apple Device Support / iTunes  
3. Forward WDA: `iproxy 8100 8100`  
4. `npm start` in `ios-controller/`

---

## Troubleshooting

| Symptom | Fix |
| :--- | :--- |
| `check-setup` says Xcode downloading | Wait for App Store; open Xcode once when done |
| `tunneld` fails without sudo | Use `./scripts/start-tunnel.sh` (requests sudo) |
| `/status` connection refused | WDA not running, or run `./scripts/forward-wda.sh` |
| Signing errors on free Apple ID | Re-sign in Xcode weekly; keep unique bundle id if needed |
| Screenshot / stream empty | Developer Mode on; tunnel up; unlock phone |
| `python: command not found` | App resolves `python3` automatically; ensure `pip3 install -U pymobiledevice3` |
