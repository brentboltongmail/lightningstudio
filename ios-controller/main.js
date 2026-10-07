const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const axios = require('axios');
const { execFileSync, exec } = require('child_process');
const fs = require('fs');
const {
  ensureStack,
  getUsbDevice,
  configurePaths,
  WDA_URL
} = require('./bootstrap');

// Keep-alive HTTP to localhost — cuts per-tap TCP/handshake cost over USB proxy
const wdaHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 4,
  keepAliveMsecs: 10000
});
const wdaHttp = axios.create({
  httpAgent: wdaHttpAgent,
  proxy: false,
  validateStatus: (s) => s >= 200 && s < 500
});

let mainWindow;

// Default WDA (WebDriverAgent) endpoint when connected via USB (usbmuxd port forward)
let wdaBaseUrl = WDA_URL || 'http://127.0.0.1:8100';
let sessionId = null;

// Input queue (taps/swipes) — separate from stream/screenshot so sliders never block clicks
let inputChain = Promise.resolve();
function withInputLock(fn) {
  const run = inputChain.then(fn, fn);
  inputChain = run.catch(() => {});
  return run;
}

// Heavier WDA ops (screenshots / settings) — must not block the input queue
let wdaChain = Promise.resolve();
function withWdaLock(fn) {
  const run = wdaChain.then(fn, fn);
  wdaChain = run.catch(() => {});
  return run;
}

function configureFastInputSettings(activeSession) {
  return wdaHttp.post(
    `${wdaBaseUrl}/session/${activeSession}/appium/settings`,
    {
      settings: {
        waitForIdleTimeout: 0,
        animationCoolOffTimeout: 0,
        waitForQuiescence: false,
        shouldUseCompactResponses: true,
        snapshotTimeout: 0,
        customSnapshotTimeout: 0
      }
    },
    { timeout: 3000 }
  ).catch(() => {});
}

/** Prefer python3 on macOS/Linux; fall back to python (Windows / py launcher). */
function resolvePython() {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch (_) {
      /* try next */
    }
  }
  return 'python3';
}

const pythonBin = resolvePython();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    show: true,
    backgroundColor: '#121214',
    title: 'iOS Screen & Macro Controller',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  configurePaths({
    root: app.isPackaged ? process.resourcesPath : __dirname,
    configPath: path.join(app.getPath('userData'), 'ios-controller.json')
  });
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handlers for Automation & Device Communication ---

// 1. Configure WDA URL
ipcMain.handle('set-wda-url', async (event, url) => {
  wdaBaseUrl = url.replace(/\/+$/, '');
  return { status: 'ok', url: wdaBaseUrl };
});

// 2. Test Connection / Get Status
ipcMain.handle('check-device-status', async () => {
  try {
    const res = await axios.get(`${wdaBaseUrl}/status`, { timeout: 3000 });
    // Prefer an existing session id from /status, otherwise create one now.
    if (res.data && res.data.sessionId) {
      sessionId = res.data.sessionId;
    } else {
      await getSession(true);
    }
    return { success: true, data: res.data, sessionId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 2b. Probe USB iPhone (no stack bring-up)
ipcMain.handle('probe-device', async () => {
  const device = getUsbDevice();
  let wdaReady = false;
  try {
    const res = await axios.get(`${wdaBaseUrl}/status`, { timeout: 1500 });
    wdaReady = !!(res.data?.value?.ready || res.data?.sessionId || res.status === 200);
  } catch (_) { /* down */ }
  return { ...device, wdaReady };
});

// 2c. Auto/manual: tunnel + proxy + WDA + session
ipcMain.handle('bootstrap-connect', async (event) => {
  const send = (msg) => {
    try {
      event.sender.send('bootstrap-progress', msg);
    } catch (_) { /* window gone */ }
  };

  const device = getUsbDevice();
  if (!device.connected) {
    return {
      success: false,
      error: 'No iPhone detected over USB',
      device,
      wdaUrl: WDA_URL,
      mjpegUrl: 'http://127.0.0.1:9100/'
    };
  }
  send(`Found ${device.name || device.model || 'iPhone'}${device.model ? ` (${device.model})` : ''}`);

  const stack = await ensureStack(send);
  if (!stack.success) {
    return { ...stack, device };
  }

  wdaBaseUrl = (stack.wdaUrl || WDA_URL).replace(/\/+$/, '');
  sessionId = null;
  try {
    const res = await axios.get(`${wdaBaseUrl}/status`, { timeout: 5000 });
    if (res.data?.sessionId) {
      sessionId = res.data.sessionId;
    } else {
      await getSession(true);
    }

    let width = device.width || null;
    let height = device.height || null;
    try {
      const activeSession = await getSession();
      if (activeSession) {
        const sizeRes = await axios.get(
          `${wdaBaseUrl}/session/${activeSession}/window/size`,
          { timeout: 3000 }
        );
        const size = sizeRes.data?.value || sizeRes.data;
        if (size?.width && size?.height) {
          width = size.width;
          height = size.height;
        }
      }
    } catch (_) { /* use product-type fallback */ }

    send(sessionId ? `Session ready (${sessionId.slice(0, 8)}…)` : 'Connected');
    return {
      success: true,
      sessionId,
      wdaUrl: wdaBaseUrl,
      mjpegUrl: stack.mjpegUrl,
      steps: stack.steps,
      alreadyUp: !!stack.alreadyUp,
      data: res.data,
      device: { ...device, width, height }
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      wdaUrl: wdaBaseUrl,
      mjpegUrl: stack.mjpegUrl,
      steps: stack.steps,
      device
    };
  }
});

// Helper to ensure a session exists (modern Appium WDA requires one for taps)
async function getSession(forceNew = false) {
  if (sessionId && !forceNew) return sessionId;
  try {
    const res = await wdaHttp.post(`${wdaBaseUrl}/session`, {
      capabilities: { alwaysMatch: {}, firstMatch: [{}] }
    }, { timeout: 8000 });
    sessionId = res.data?.sessionId || res.data?.value?.sessionId;
    if (sessionId) await configureFastInputSettings(sessionId);
    return sessionId;
  } catch (e) {
    sessionId = null;
    return null;
  }
}

async function wdaTap(x, y) {
  return withInputLock(async () => {
    const activeSession = await getSession();
    if (!activeSession) throw new Error('No WDA session');

    // Prefer compact W3C pointer actions (no idle wait) over /wda/tap
    try {
      const res = await wdaHttp.post(
        `${wdaBaseUrl}/session/${activeSession}/actions`,
        {
          actions: [{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x, y },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerUp', button: 0 }
            ]
          }]
        },
        { timeout: 2500 }
      );
      if (res.status >= 400) throw new Error(`actions ${res.status}`);
      return { success: true, response: res.data, method: 'wda_actions' };
    } catch (_) {
      const res = await wdaHttp.post(
        `${wdaBaseUrl}/session/${activeSession}/wda/tap`,
        { x, y },
        { timeout: 2500 }
      );
      if (res.status >= 400) throw new Error(res.data?.value?.message || `tap ${res.status}`);
      return { success: true, response: res.data, method: 'wda_tap' };
    }
  });
}

async function wdaSwipe(fromX, fromY, toX, toY, durationSec) {
  return withInputLock(async () => {
    const activeSession = await getSession();
    if (!activeSession) throw new Error('No WDA session');
    const sec = Math.min(0.25, Math.max(0.08, durationSec || 0.12));
    const ms = Math.round(sec * 1000);

    try {
      const res = await wdaHttp.post(
        `${wdaBaseUrl}/session/${activeSession}/actions`,
        {
          actions: [{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: fromX, y: fromY },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: ms, x: toX, y: toY },
              { type: 'pointerUp', button: 0 }
            ]
          }]
        },
        { timeout: 3500 }
      );
      if (res.status >= 400) throw new Error(`actions ${res.status}`);
      return { success: true, response: res.data, method: 'wda_actions' };
    } catch (_) {
      const res = await wdaHttp.post(
        `${wdaBaseUrl}/session/${activeSession}/wda/dragfromtoforduration`,
        { fromX, fromY, toX, toY, duration: sec },
        { timeout: 3500 }
      );
      if (res.status >= 400) throw new Error(`drag ${res.status}`);
      return { success: true, response: res.data, method: 'wda_drag' };
    }
  });
}

// 3. Send Movement via Bluetooth Mouse (optional Windows AssistiveTouch path)
ipcMain.handle('send-move', async (event, { dx, dy }) => {
  try {
    await axios.post('http://127.0.0.1:8200/move', { dx, dy }, { timeout: 800 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 4. Send Single Tap — WDA first on macOS; BT mouse is optional fallback
ipcMain.handle('send-tap', async (event, { x, y }) => {
  try {
    return await wdaTap(x, y);
  } catch (wdaErr) {
    try {
      await axios.post('http://127.0.0.1:8200/click', { buttons: 1 }, { timeout: 800 });
      return { success: true, method: 'bluetooth_mouse' };
    } catch (btErr) {
      return { success: false, error: wdaErr.message, simulated: true };
    }
  }
});

// 5. Send Drag / Swipe
ipcMain.handle('send-swipe', async (event, { fromX, fromY, toX, toY, duration }) => {
  try {
    return await wdaSwipe(fromX, fromY, toX, toY, duration);
  } catch (err) {
    return { success: false, error: err.message, simulated: true };
  }
});

// 6. Window size from WDA (points)
ipcMain.handle('get-window-size', async () => {
  try {
    const activeSession = await getSession();
    if (!activeSession) return { success: false, error: 'No WDA session' };
    const res = await axios.get(`${wdaBaseUrl}/session/${activeSession}/window/size`, { timeout: 3000 });
    const size = res.data?.value || res.data;
    return { success: true, width: size.width, height: size.height };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 6b. Tune MJPEG stream (half-res / low quality = much less USB bandwidth)
ipcMain.handle('configure-stream', async (event, opts = {}) => {
  return withWdaLock(async () => {
    try {
      const activeSession = await getSession();
      if (!activeSession) return { success: false, error: 'No WDA session' };
      const settings = {
        // Low scale/quality keeps the USB stream tiny by default
        mjpegScalingFactor: opts.scale ?? 20,
        mjpegServerScreenshotQuality: opts.quality ?? 5,
        mjpegServerFramerate: opts.fps ?? 15,
        screenshotQuality: opts.screenshotQuality ?? 2,
        // Keep input snappy even when retuning the stream
        waitForIdleTimeout: 0,
        animationCoolOffTimeout: 0,
        waitForQuiescence: false
      };
      await wdaHttp.post(
        `${wdaBaseUrl}/session/${activeSession}/appium/settings`,
        { settings },
        { timeout: 5000 }
      );
      return { success: true, settings, mjpegUrl: 'http://127.0.0.1:9100/' };
    } catch (err) {
      return { success: false, error: err.message, mjpegUrl: 'http://127.0.0.1:9100/' };
    }
  });
});

// 7. Fetch live screen — prefer WDA screenshot (fast); fall back to pymobiledevice3 DVT
ipcMain.handle('fetch-live-screen', async () => {
  // WDA path shares the USB tunnel but avoids spawning a Python process every frame
  try {
    const shot = await withWdaLock(async () => {
      const activeSession = await getSession();
      if (!activeSession) throw new Error('No WDA session');
      const res = await axios.get(
        `${wdaBaseUrl}/session/${activeSession}/screenshot`,
        { timeout: 6000 }
      );
      const b64 = res.data?.value || res.data;
      if (!b64 || typeof b64 !== 'string') throw new Error('Empty screenshot');
      return `data:image/png;base64,${b64}`;
    });
    return { success: true, base64: shot, method: 'wda' };
  } catch (wdaErr) {
    const screenFile = path.join(__dirname, 'current_screen.png');
    const cmd = `${pythonBin} -m pymobiledevice3 developer dvt screenshot current_screen.png`;

    return new Promise((resolve) => {
      exec(cmd, { cwd: __dirname, timeout: 10000 }, (err) => {
        if (err && !fs.existsSync(screenFile)) {
          return resolve({ success: false, error: wdaErr.message || err.message });
        }
        try {
          const imageBase64 = fs.readFileSync(screenFile, { encoding: 'base64' });
          resolve({ success: true, base64: `data:image/png;base64,${imageBase64}`, method: 'dvt' });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });
  }
});
