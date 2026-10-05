const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');

let mainWindow;

// Default WDA (WebDriverAgent) endpoint when connected via USB (usbmuxd port forward)
let wdaBaseUrl = 'http://127.0.0.1:8100';
let sessionId = null;

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
    // Try to get or establish active session
    if (res.data && res.data.sessionId) {
      sessionId = res.data.sessionId;
    }
    return { success: true, data: res.data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Helper to ensure a session exists
async function getSession() {
  if (sessionId) return sessionId;
  try {
    const res = await axios.post(`${wdaBaseUrl}/session`, {
      capabilities: {}
    }, { timeout: 4000 });
    sessionId = res.data?.sessionId || res.data?.value?.sessionId;
    return sessionId;
  } catch (e) {
    // Some WDA versions operate session-less or accept 'null'
    return null;
  }
}

// 3. Send Single Tap
ipcMain.handle('send-tap', async (event, { x, y }) => {
  console.log(`[IPC] Tap requested at (${x}, ${y})`);
  try {
    const activeSession = await getSession();
    const endpoint = activeSession 
      ? `${wdaBaseUrl}/session/${activeSession}/wda/tap/0`
      : `${wdaBaseUrl}/wda/tap/0`;

    const res = await axios.post(endpoint, { x, y }, { timeout: 3000 });
    return { success: true, response: res.data };
  } catch (err) {
    console.warn(`[Tap Failed] ${err.message}`);
    // Return simulated success if phone daemon not yet active so testing is smooth
    return { success: false, error: err.message, simulated: true };
  }
});

// 4. Send Drag / Swipe
ipcMain.handle('send-swipe', async (event, { fromX, fromY, toX, toY, duration }) => {
  console.log(`[IPC] Swipe requested from (${fromX}, ${fromY}) to (${toX}, ${toY}) over ${duration}s`);
  try {
    const activeSession = await getSession();
    const endpoint = activeSession
      ? `${wdaBaseUrl}/session/${activeSession}/wda/dragfromtoforduration`
      : `${wdaBaseUrl}/wda/dragfromtoforduration`;

    const res = await axios.post(endpoint, {
      fromX,
      fromY,
      toX,
      toY,
      duration: duration || 0.4
    }, { timeout: 4000 });
    return { success: true, response: res.data };
  } catch (err) {
    console.warn(`[Swipe Failed] ${err.message}`);
    return { success: false, error: err.message, simulated: true };
  }
});

// 5. Fetch live screen snapshot from iPhone over USB DVT
ipcMain.handle('fetch-live-screen', async () => {
  const { exec } = require('child_process');
  const fs = require('fs');
  const screenFile = path.join(__dirname, 'current_screen.png');

  return new Promise((resolve) => {
    exec('python -m pymobiledevice3 developer dvt screenshot current_screen.png', { cwd: __dirname, timeout: 8000 }, (err) => {
      if (err && !fs.existsSync(screenFile)) {
        return resolve({ success: false, error: err.message });
      }
      try {
        const imageBase64 = fs.readFileSync(screenFile, { encoding: 'base64' });
        resolve({ success: true, base64: `data:image/png;base64,${imageBase64}` });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  });
});
