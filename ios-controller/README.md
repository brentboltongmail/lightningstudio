# iOS Screen & Macro Controller (Electron + HTML/JS)

An Electron-based desktop app to control an iPhone connected via USB, map mouse clicks and drags to native iOS touch coordinates, record action macros, and replay them on repeat.

---

## 🚀 Features

- **Pixel & Coordinate Mapping:** Automatically maps your PC mouse clicks and drags on the mirrored display directly to native iPhone screen points (e.g. 393 × 852 for iPhone 14/15/16 Pro).
- **Macro Recorder:** 
  - Record sequence of taps and swipes with precise timing offsets.
  - Delete individual steps or clear history.
  - Loop macros with customizable iteration counts, delays, or infinite loop mode.
  - Export and import macro sequences as `.json` files.
- **Visual Feedback:** Animated touch ripples on clicks and live coordinate readouts.
- **Dual Execution Mode:**
  - Works with active **WebDriverAgent / USB automation daemons**.
  - Has a built-in simulation fallback mode for offline testing.

---

## 🛠 Prerequisites for Real iPhone Control

To send real touch events to an iPhone over USB on Windows:

1. **Enable Developer Mode on iPhone:**
   - Go to **Settings > Privacy & Security > Developer Mode** and switch it **On**. (The phone will restart).
2. **Install iTunes / Apple Device Support on Windows:**
   - Provides Apple USB drivers (`usbmuxd`).
3. **Run WebDriverAgent Runner on the iPhone:**
   - Forward port 8100 over USB to PC:
     ```bash
     # Using iproxy / pymobiledevice3 / usbmuxd:
     iproxy 8100 8100
     ```
   - Test by opening `http://localhost:8100/status` in your browser.

---

## 💻 Running the Electron App

```bash
cd ios-controller
npm start
```
