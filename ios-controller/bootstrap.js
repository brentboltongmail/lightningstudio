/**
 * One-click stack bring-up: tunneld → localhost proxy (8100/9100) → WDA → ready.
 */
const { spawn, execFileSync, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const axios = require('axios');

let ROOT = __dirname;
let PROXY_SCRIPT = path.join(ROOT, 'scripts', 'wda-proxy.py');
let WDA_DIR = path.join(ROOT, 'WebDriverAgent');
let CONFIG_PATH = path.join(ROOT, '.ios-controller.json');
const TUNNEL_API = 'http://127.0.0.1:49151/';
const WDA_URL = 'http://127.0.0.1:8100';
const MJPEG_URL = 'http://127.0.0.1:9100/';
const WDA_BUNDLE = 'com.facebook.WebDriverAgentRunner.xctrunner';

/** Call once from main when Electron is ready (packaged apps use Resources/). */
function configurePaths({ root, configPath } = {}) {
  if (root) {
    ROOT = root;
    PROXY_SCRIPT = path.join(ROOT, 'scripts', 'wda-proxy.py');
    // Packaged: extraResources; dev: project root
    const bundled = path.join(ROOT, 'WebDriverAgent');
    const sibling = path.join(__dirname, 'WebDriverAgent');
    WDA_DIR = fs.existsSync(bundled) ? bundled : sibling;
  }
  if (configPath) CONFIG_PATH = configPath;
  // Seed user config from repo defaults once
  if (configPath && !fs.existsSync(configPath)) {
    const seed = path.join(__dirname, '.ios-controller.json');
    try {
      if (fs.existsSync(seed)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.copyFileSync(seed, configPath);
      }
    } catch (_) { /* ignore */ }
  }
}

/** ProductType → { model, width, height } in logical points (portrait). */
const PRODUCT_TYPES = {
  // iPhone 17 family
  'iPhone18,1': { model: 'iPhone 17 Pro', width: 402, height: 874 },
  'iPhone18,2': { model: 'iPhone 17 Pro Max', width: 440, height: 956 },
  'iPhone18,3': { model: 'iPhone 17', width: 402, height: 874 },
  'iPhone18,4': { model: 'iPhone Air', width: 420, height: 912 },
  // iPhone 16
  'iPhone17,1': { model: 'iPhone 16 Pro', width: 402, height: 874 },
  'iPhone17,2': { model: 'iPhone 16 Pro Max', width: 440, height: 956 },
  'iPhone17,3': { model: 'iPhone 16', width: 393, height: 852 },
  'iPhone17,4': { model: 'iPhone 16 Plus', width: 430, height: 932 },
  // iPhone 15
  'iPhone15,4': { model: 'iPhone 15', width: 393, height: 852 },
  'iPhone15,5': { model: 'iPhone 15 Plus', width: 430, height: 932 },
  'iPhone16,1': { model: 'iPhone 15 Pro', width: 393, height: 852 },
  'iPhone16,2': { model: 'iPhone 15 Pro Max', width: 430, height: 932 },
  // iPhone 14
  'iPhone14,7': { model: 'iPhone 14', width: 390, height: 844 },
  'iPhone14,8': { model: 'iPhone 14 Plus', width: 428, height: 926 },
  'iPhone15,2': { model: 'iPhone 14 Pro', width: 393, height: 852 },
  'iPhone15,3': { model: 'iPhone 14 Pro Max', width: 430, height: 932 },
  // iPhone 13
  'iPhone14,2': { model: 'iPhone 13 Pro', width: 390, height: 844 },
  'iPhone14,3': { model: 'iPhone 13 Pro Max', width: 428, height: 926 },
  'iPhone14,4': { model: 'iPhone 13 mini', width: 375, height: 812 },
  'iPhone14,5': { model: 'iPhone 13', width: 390, height: 844 },
  // iPhone 12
  'iPhone13,1': { model: 'iPhone 12 mini', width: 360, height: 780 },
  'iPhone13,2': { model: 'iPhone 12', width: 390, height: 844 },
  'iPhone13,3': { model: 'iPhone 12 Pro', width: 390, height: 844 },
  'iPhone13,4': { model: 'iPhone 12 Pro Max', width: 428, height: 926 },
  // SE
  'iPhone14,6': { model: 'iPhone SE (3rd)', width: 375, height: 667 },
  'iPhone12,8': { model: 'iPhone SE (2nd)', width: 375, height: 667 }
};

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveConfig(partial) {
  const next = { ...loadConfig(), ...partial };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return next;
}

function resolvePython() {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch (_) { /* next */ }
  }
  return 'python3';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpProbe(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      // MJPEG never ends — drop the socket as soon as headers arrive
      res.destroy();
      req.destroy();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function wdaStatus(timeout = 2500) {
  try {
    const res = await axios.get(`${WDA_URL}/status`, { timeout });
    return { ok: !!(res.data?.value?.ready || res.data?.sessionId || res.status === 200), data: res.data };
  } catch (_) {
    return { ok: false };
  }
}

function processRunning(pattern) {
  try {
    const out = execFileSync('pgrep', ['-fl', pattern], { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch (_) {
    return false;
  }
}

function readTeamId() {
  const cfg = loadConfig();
  if (cfg.teamId) return cfg.teamId;
  const pbx = path.join(WDA_DIR, 'WebDriverAgent.xcodeproj', 'project.pbxproj');
  try {
    const text = fs.readFileSync(pbx, 'utf8');
    const matches = [...text.matchAll(/DEVELOPMENT_TEAM\s*=\s*([A-Z0-9]{10})\s*;/g)];
    if (matches.length) {
      const id = matches[matches.length - 1][1];
      saveConfig({ teamId: id });
      return id;
    }
  } catch (_) { /* ignore */ }
  return process.env.TEAM_ID || null;
}

/**
 * Lightweight USB presence + identity via lockdown (no tunnel required).
 * @returns {{ connected: boolean, name?: string, model?: string, productType?: string, udid?: string, version?: string, width?: number, height?: number, error?: string }}
 */
function getUsbDevice() {
  const py = resolvePython();
  try {
    // CLI is sync and stable across pymobiledevice3 versions (lockdown API is async now)
    const raw = execFileSync(py, ['-m', 'pymobiledevice3', 'lockdown', 'info'], {
      encoding: 'utf8',
      timeout: 12000,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    // stdout may include warnings before JSON
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end < 0) return { connected: false, error: 'No device info' };
    const data = JSON.parse(raw.slice(start, end + 1));
    const productType = data.ProductType || null;
    const mapped = PRODUCT_TYPES[productType] || null;
    const info = {
      connected: true,
      name: data.DeviceName || 'iPhone',
      productType,
      version: data.ProductVersion || data.HumanReadableProductVersionString || null,
      udid: data.UniqueDeviceID || null,
      model: mapped?.model || productType || 'iPhone',
      width: mapped?.width,
      height: mapped?.height
    };
    if (info.udid) saveConfig({ udid: info.udid });
    return info;
  } catch (err) {
    const msg = (err.stderr && String(err.stderr)) || err.message || 'No device';
    return { connected: false, error: msg.split('\n')[0] };
  }
}

function detectUdid() {
  const usb = getUsbDevice();
  if (usb.connected && usb.udid) return usb.udid;
  const cfg = loadConfig();
  if (cfg.udid) return cfg.udid;
  try {
    const out = execFileSync('xcrun', ['xctrace', 'list', 'devices'], {
      encoding: 'utf8',
      stderr: 'pipe',
      timeout: 15000
    });
    const line = out.split('\n').find((l) => /iPhone|iPad/.test(l) && !/Simulator/i.test(l));
    const m = line && line.match(/\(([0-9A-Fa-f-]{20,})\)/);
    if (m) {
      saveConfig({ udid: m[1] });
      return m[1];
    }
  } catch (_) { /* ignore */ }
  try {
    const py = resolvePython();
    const raw = execFileSync(py, ['-m', 'pymobiledevice3', 'usbmux', 'list'], {
      encoding: 'utf8',
      timeout: 10000
    });
    const m = raw.match(/[0-9A-Fa-f-]{25,}/);
    if (m) {
      saveConfig({ udid: m[0] });
      return m[0];
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function ensureTunneld(onProgress) {
  if (await httpProbe(TUNNEL_API, 1500)) {
    onProgress('USB tunnel already running');
    return true;
  }
  onProgress('Starting USB developer tunnel (may prompt for password)…');
  const py = resolvePython();
  const cmd = `${py} -m pymobiledevice3 remote tunneld >/tmp/tunneld.log 2>&1 &`;
  try {
    execFileSync('osascript', [
      '-e',
      `do shell script ${JSON.stringify(cmd)} with administrator privileges`
    ], { timeout: 120000, stdio: 'ignore' });
  } catch (err) {
    onProgress(`Tunnel start failed: ${err.message}`);
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await httpProbe(TUNNEL_API, 1500)) {
      onProgress('USB tunnel ready');
      return true;
    }
  }
  onProgress('Tunnel did not come up in time');
  return false;
}

async function resolveTunnelAddr() {
  try {
    const res = await axios.get(TUNNEL_API, { timeout: 3000 });
    const tunnels = Object.values(res.data || {})[0];
    return tunnels?.[0]?.['tunnel-address'] || null;
  } catch (_) {
    return null;
  }
}

function startProxyDetached(tunnelAddr) {
  const py = resolvePython();
  const logFd = fs.openSync('/tmp/wda_proxy.log', 'a');
  const child = spawn(py, [PROXY_SCRIPT], {
    env: { ...process.env, WDA_TUNNEL_ADDR: tunnelAddr || '' },
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  child.unref();
  fs.closeSync(logFd);
  return child.pid;
}

async function ensureProxy(onProgress) {
  if ((await httpProbe(`${WDA_URL}/status`, 1500)) || (await httpProbe(MJPEG_URL, 1500))) {
    // One of the ports answers — if WDA status works we're fully good
    if ((await wdaStatus()).ok) {
      onProgress('Local WDA proxy already up');
      return true;
    }
  }

  const addr = await resolveTunnelAddr();
  if (!addr) {
    onProgress('No tunnel address — is the iPhone plugged in?');
    return false;
  }

  // Kill stale proxies, then start a detached one
  try {
    execFileSync('pkill', ['-f', 'wda-proxy.py'], { stdio: 'ignore' });
  } catch (_) { /* none */ }
  await sleep(400);

  onProgress(`Starting localhost proxy → [${addr}]`);
  startProxyDetached(addr);

  for (let i = 0; i < 15; i++) {
    await sleep(400);
    if ((await wdaStatus()).ok || (await httpProbe(MJPEG_URL, 1200))) {
      onProgress('Local proxy ready (8100 / 9100)');
      return true;
    }
  }
  onProgress('Proxy started but ports not responding yet');
  return false;
}

function wdaProjectPath() {
  const proj = path.join(WDA_DIR, 'WebDriverAgent.xcodeproj');
  return fs.existsSync(proj) ? proj : null;
}

let wdaBuildProc = null;

function startWdaXcodebuild(onProgress) {
  const project = wdaProjectPath();
  if (!project) {
    onProgress('WebDriverAgent project missing — run scripts/deploy-wda.sh once');
    return false;
  }
  const udid = detectUdid();
  const teamId = readTeamId();
  if (!udid) {
    onProgress('No iPhone UDID found — plug in the device and Trust This Computer');
    return false;
  }
  if (!teamId) {
    onProgress('No DEVELOPMENT_TEAM found — set TEAM_ID or sign WDA in Xcode once');
    return false;
  }

  if (wdaBuildProc && !wdaBuildProc.killed) {
    onProgress('WDA launch already in progress…');
    return true;
  }

  onProgress(`Launching WebDriverAgent on device (${udid.slice(0, 8)}…)`);
  const args = [
    'test',
    '-project', project,
    '-scheme', 'WebDriverAgentRunner',
    '-destination', `id=${udid}`,
    `DEVELOPMENT_TEAM=${teamId}`,
    'CODE_SIGN_IDENTITY=Apple Development',
    `PRODUCT_BUNDLE_IDENTIFIER=${WDA_BUNDLE}`
  ];
  const logFd = fs.openSync('/tmp/wda_xcodebuild.log', 'a');
  wdaBuildProc = spawn('xcodebuild', args, {
    cwd: WDA_DIR,
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });
  wdaBuildProc.unref();
  fs.closeSync(logFd);
  wdaBuildProc.on('exit', () => { wdaBuildProc = null; });
  saveConfig({ udid, teamId });
  return true;
}

async function waitForWda(onProgress, maxWaitMs = 90000) {
  const start = Date.now();
  let launched = false;
  while (Date.now() - start < maxWaitMs) {
    const st = await wdaStatus();
    if (st.ok) {
      onProgress('WebDriverAgent is ready');
      return true;
    }
    // After a few seconds with no response, kick off xcodebuild once
    if (!launched && Date.now() - start > 2500) {
      launched = startWdaXcodebuild(onProgress);
    }
    await sleep(1500);
  }
  return false;
}

/**
 * Bring up the full stack. Calls onProgress(msg) for UI logging.
 * @returns {{ success: boolean, error?: string, steps: string[], wdaUrl: string, mjpegUrl: string }}
 */
async function ensureStack(onProgress = () => {}) {
  const steps = [];
  const note = (msg) => {
    steps.push(msg);
    onProgress(msg);
  };

  // Fast path: already fully up
  if ((await wdaStatus()).ok) {
    note('WDA already reachable on localhost:8100');
    return { success: true, steps, wdaUrl: WDA_URL, mjpegUrl: MJPEG_URL, alreadyUp: true };
  }

  const tunnelOk = await ensureTunneld(note);
  if (!tunnelOk) {
    return {
      success: false,
      error: 'USB tunnel unavailable. Plug in the iPhone and allow the macOS password prompt.',
      steps,
      wdaUrl: WDA_URL,
      mjpegUrl: MJPEG_URL
    };
  }

  await ensureProxy(note);

  if ((await wdaStatus()).ok) {
    return { success: true, steps, wdaUrl: WDA_URL, mjpegUrl: MJPEG_URL };
  }

  note('Waiting for WebDriverAgent (starting it if needed)…');
  const ready = await waitForWda(note, 90000);
  // Proxy may need a restart after WDA comes up
  if (ready) {
    await ensureProxy(note);
  }

  if (!(await wdaStatus()).ok) {
    return {
      success: false,
      error: 'WebDriverAgent did not start. Keep Xcode Product → Test running, or check /tmp/wda_xcodebuild.log',
      steps,
      wdaUrl: WDA_URL,
      mjpegUrl: MJPEG_URL
    };
  }

  return { success: true, steps, wdaUrl: WDA_URL, mjpegUrl: MJPEG_URL };
}

module.exports = {
  ensureStack,
  getUsbDevice,
  configurePaths,
  loadConfig,
  saveConfig,
  PRODUCT_TYPES,
  WDA_URL,
  MJPEG_URL
};
