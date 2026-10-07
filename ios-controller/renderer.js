// DOM Elements
const canvas = document.getElementById('screenCanvas');
const ctx = canvas.getContext('2d');
const screenWrapper = document.getElementById('screenWrapper');
const statusBadge = document.getElementById('statusBadge');
const deviceInfoEl = document.getElementById('deviceInfo');
const touchRipple = document.getElementById('touchRipple');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const playBtn = document.getElementById('playBtn');
const clearBtn = document.getElementById('clearBtn');
const loopCountInput = document.getElementById('loopCount');
const loopDelayInput = document.getElementById('loopDelay');
const infiniteLoopCheckbox = document.getElementById('infiniteLoop');
const stepList = document.getElementById('stepList');
const stepCount = document.getElementById('stepCount');
const logOutput = document.getElementById('logOutput');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const fileInput = document.getElementById('fileInput');

function setStatus(text, kind = 'disconnected') {
  if (!statusBadge) return;
  statusBadge.innerText = text;
  statusBadge.className = `badge ${kind}`;
}

// Fallback mock if running in a regular web browser instead of Electron
if (!window.electronAPI) {
  window.electronAPI = {
    setWdaUrl: async (url) => ({ status: 'ok', url }),
    checkDeviceStatus: async () => ({ success: false, error: 'Running in browser preview mode (WDA bridge inactive)' }),
    bootstrapConnect: async () => ({ success: false, error: 'Running in browser preview mode' }),
    probeDevice: async () => ({ connected: false }),
    onBootstrapProgress: () => () => {},
    sendTap: async ({ x, y }) => ({ success: true, simulated: true }),
    sendSwipe: async (gesture) => ({ success: true, simulated: true })
  };
}

// State
let isRecording = false;
let isPlaying = false;
let recordedSteps = [];
let lastEventTime = null;
let isDragging = false;
let dragStartCoords = null;

// Initialize canvas background (mock iOS wallpaper until live screen stream connects)
function initCanvas(width = 393, height = 852) {
  canvas.width = width;
  canvas.height = height;

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#1e3c72');
  grad.addColorStop(1, '#2a5298');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Draw simulated iOS icons & UI
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('9:41', width / 2, 90);

  ctx.font = '16px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillText('Connect USB & WDA to mirror live', width / 2, 130);

  // App grid placeholders
  const cols = 4;
  const rows = 5;
  const iconSize = 56;
  const startX = (width - (cols * 72)) / 2 + 10;
  const startY = 180;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * 75;
      const y = startY + r * 85;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.roundRect(x, y, iconSize, iconSize, 14);
      ctx.fill();
    }
  }

  // Dock
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.beginPath();
  ctx.roundRect(24, height - 100, width - 48, 76, 26);
  ctx.fill();
}

// Logical iOS points used for WDA taps (must NOT follow screenshot pixel size)
let devicePoints = { width: 440, height: 956 };
initCanvas(devicePoints.width, devicePoints.height);

async function renderScreenImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      // Keep canvas in device points so click→WDA mapping stays correct.
      // Screenshots are often retina pixels (much larger); scale them into the canvas.
      if (canvas.width !== devicePoints.width || canvas.height !== devicePoints.height) {
        canvas.width = devicePoints.width;
        canvas.height = devicePoints.height;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(true);
    };
    img.src = src;
  });
}

// Initial check for current_screen.png
renderScreenImage('current_screen.png?t=' + Date.now()).catch(() => {});

// Auto Stream — prefer WDA MJPEG (half-res JPEG stream on :9100). Polling PNGs is the slow path.
let isAutoStreaming = false;
let autoStreamTimer = null;
let streamBusy = false;
let inputBusy = false;
let useMjpeg = false;
const STREAM_GAP_MS = 700; // fallback PNG poll gap only
const MJPEG_URL = 'http://127.0.0.1:9100/';
const autoStreamBtn = document.getElementById('autoStreamBtn');
const liveMjpeg = document.getElementById('liveMjpeg');
const streamQualityInput = document.getElementById('streamQuality');
const streamQualityVal = document.getElementById('streamQualityVal');
const streamScaleInput = document.getElementById('streamScale');
const streamScaleVal = document.getElementById('streamScaleVal');

function getStreamOpts() {
  const quality = streamQualityInput ? Number(streamQualityInput.value) : 5;
  const scale = streamScaleInput ? Number(streamScaleInput.value) : 20;
  return { quality, scale, fps: 15 };
}

function stopMjpeg() {
  useMjpeg = false;
  if (liveMjpeg) {
    liveMjpeg.classList.remove('active');
    liveMjpeg.removeAttribute('src');
  }
  canvas.classList.remove('mjpeg-mode');
}

function startMjpeg() {
  if (!liveMjpeg) return false;
  useMjpeg = true;
  // Cache-bust so Chromium reconnects to the multipart stream
  liveMjpeg.src = `${MJPEG_URL}?t=${Date.now()}`;
  liveMjpeg.classList.add('active');
  canvas.classList.add('mjpeg-mode');
  return true;
}

let streamTuneTimer = null;
async function applyStreamSliders(restartMjpeg = true) {
  const opts = getStreamOpts();
  if (streamQualityVal) streamQualityVal.innerText = String(opts.quality);
  if (streamScaleVal) streamScaleVal.innerText = String(opts.scale);
  if (!window.electronAPI?.configureStream) return;
  const cfg = await window.electronAPI.configureStream(opts);
  if (cfg?.success) {
    log(`Stream: ${opts.scale}% scale, JPEG ${opts.quality}%`, 'info');
  }
  // Reconnect MJPEG so new quality/scale takes effect immediately
  if (restartMjpeg && isAutoStreaming && useMjpeg) {
    startMjpeg();
  }
}

function scheduleStreamTune() {
  if (streamQualityVal && streamQualityInput) {
    streamQualityVal.innerText = String(streamQualityInput.value);
  }
  if (streamScaleVal && streamScaleInput) {
    streamScaleVal.innerText = String(streamScaleInput.value);
  }
  clearTimeout(streamTuneTimer);
  streamTuneTimer = setTimeout(() => applyStreamSliders(true), 250);
}

if (streamQualityInput) {
  streamQualityInput.addEventListener('input', scheduleStreamTune);
}
if (streamScaleInput) {
  streamScaleInput.addEventListener('input', scheduleStreamTune);
}

async function triggerSingleScreenCapture() {
  if (streamBusy || inputBusy || useMjpeg) return false;
  streamBusy = true;
  try {
    if (window.electronAPI && window.electronAPI.fetchLiveScreen) {
      const res = await window.electronAPI.fetchLiveScreen();
      if (res.success && res.base64) {
        await renderScreenImage(res.base64);
        return true;
      }
    }
  } catch (e) {
    // ignore dropped frames during auto-streaming
  } finally {
    streamBusy = false;
  }
  return false;
}

async function startAutoStream() {
  if (isAutoStreaming) return true;
  isAutoStreaming = true;
  if (autoStreamBtn) {
    autoStreamBtn.innerText = 'Stream: On';
    autoStreamBtn.className = 'btn small play';
  }

  // MJPEG via WDA — quality/scale from sliders (dramatically less USB than PNG polls)
  await applyStreamSliders(false);

  // Probe MJPEG quickly; fall back to PNG polling if proxy/port isn't up
  const mjpegOk = await new Promise((resolve) => {
    const probe = new Image();
    const timer = setTimeout(() => {
      probe.src = '';
      resolve(false);
    }, 2500);
    probe.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    probe.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    probe.src = `${MJPEG_URL}?probe=${Date.now()}`;
  });

  if (mjpegOk && startMjpeg()) {
    log('Live MJPEG stream ON (fast path).', 'success');
    return true;
  }

  stopMjpeg();
  log(`MJPEG unavailable — falling back to PNG poll every ${STREAM_GAP_MS}ms.`, 'info');
  const streamLoop = async () => {
    if (!isAutoStreaming) return;
    await triggerSingleScreenCapture();
    if (isAutoStreaming) {
      autoStreamTimer = setTimeout(streamLoop, STREAM_GAP_MS);
    }
  };
  streamLoop();
  return true;
}

function stopAutoStream() {
  if (!isAutoStreaming) return;
  isAutoStreaming = false;
  clearTimeout(autoStreamTimer);
  stopMjpeg();
  if (autoStreamBtn) {
    autoStreamBtn.innerText = 'Stream: Off';
    autoStreamBtn.className = 'btn small';
  }
  log('Live stream stopped.');
}

// Continuous Auto-Stream Toggle
if (autoStreamBtn) {
  autoStreamBtn.addEventListener('click', async () => {
    if (isAutoStreaming) stopAutoStream();
    else await startAutoStream();
  });
}

function setDeviceInfo(text) {
  if (deviceInfoEl) deviceInfoEl.textContent = text;
}

function applyDeviceSize(width, height, label) {
  if (!width || !height) return;
  if (devicePoints.width === width && devicePoints.height === height) {
    if (label) setDeviceInfo(label);
    return;
  }
  devicePoints = { width, height };
  initCanvas(width, height);
  if (label) setDeviceInfo(label);
  else setDeviceInfo(`${width} × ${height}`);
  log(`Canvas synced to ${width}×${height}`, 'success');
}

function deviceLabel(device) {
  if (!device) return 'Looking for an iPhone…';
  const name = device.name || device.model || 'iPhone';
  const model = device.model && device.model !== name ? ` · ${device.model}` : '';
  const size = device.width && device.height ? ` · ${device.width}×${device.height}` : '';
  const ver = device.version ? ` · iOS ${device.version}` : '';
  return `${name}${model}${size}${ver}`;
}

// Helper Logger
function log(msg, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.innerText = `[${timestamp}] ${msg}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

// Convert screen mouse click event to Phone (X, Y) Coordinates
function getPhoneCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const clientX = event.clientX - rect.left;
  const clientY = event.clientY - rect.top;

  const phoneX = Math.round(Math.max(0, Math.min(clientX * scaleX, canvas.width)));
  const phoneY = Math.round(Math.max(0, Math.min(clientY * scaleY, canvas.height)));

  return { x: phoneX, y: phoneY, rawX: clientX, rawY: clientY };
}

// Show visual ripple on click/tap
function triggerRipple(rawX, rawY) {
  touchRipple.style.left = `${rawX}px`;
  touchRipple.style.top = `${rawY}px`;
  touchRipple.classList.remove('active');
  void touchRipple.offsetWidth; // re-flow
  touchRipple.classList.add('active');
}

// Serialize taps/swipes so rapid clicks don't stampede WDA
let inputChain = Promise.resolve();
function enqueueInput(fn) {
  inputChain = inputChain.then(fn).catch(() => {});
  return inputChain;
}

// Collapse rapid near-duplicate taps into one (time + distance) — configurable in Options
const tapMergeMsInput = document.getElementById('tapMergeMs');
const tapMergeMsVal = document.getElementById('tapMergeMsVal');
const tapMergePxInput = document.getElementById('tapMergePx');
const tapMergePxVal = document.getElementById('tapMergePxVal');
let lastGroupedTap = null; // { x, y, at }

function getTapMergeOpts() {
  const ms = tapMergeMsInput ? Number(tapMergeMsInput.value) : 30;
  const px = tapMergePxInput ? Number(tapMergePxInput.value) : 5;
  return {
    ms: Number.isFinite(ms) ? Math.max(0, ms) : 30,
    px: Number.isFinite(px) ? Math.max(0, px) : 5
  };
}

function syncTapMergeLabels() {
  const { ms, px } = getTapMergeOpts();
  if (tapMergeMsVal) tapMergeMsVal.innerText = String(ms);
  if (tapMergePxVal) tapMergePxVal.innerText = String(px);
}

if (tapMergeMsInput) {
  tapMergeMsInput.addEventListener('input', syncTapMergeLabels);
}
if (tapMergePxInput) {
  tapMergePxInput.addEventListener('input', syncTapMergeLabels);
}
syncTapMergeLabels();

function isRapidDuplicateTap(x, y) {
  const { ms, px } = getTapMergeOpts();
  if (ms <= 0 || px <= 0) return false;
  if (!lastGroupedTap) return false;
  const dt = Date.now() - lastGroupedTap.at;
  if (dt > ms) return false;
  const dist = Math.hypot(x - lastGroupedTap.x, y - lastGroupedTap.y);
  return dist <= px;
}

// Direct WDA tap (Bluetooth slam-to-zero path removed — it blocked ~20s per click on macOS).
async function executeTap(targetX, targetY) {
  if (isRapidDuplicateTap(targetX, targetY)) {
    // Extend the window so a burst stays as one tap; keep latest point
    lastGroupedTap = { x: targetX, y: targetY, at: Date.now() };
    log(`Tap merged at (${targetX}, ${targetY})`, 'info');
    return { success: true, method: 'merged' };
  }

  lastGroupedTap = { x: targetX, y: targetY, at: Date.now() };
  inputBusy = true;
  try {
    const res = await window.electronAPI.sendTap({
      x: targetX,
      y: targetY,
      width: canvas.width,
      height: canvas.height
    });
    if (res && res.success === false) {
      log(`Tap failed: ${res.error || 'unknown error'}`, 'error');
    } else {
      log(`Tap OK (${res?.method || 'wda'}) at (${targetX}, ${targetY})`, 'success');
    }
    return res;
  } finally {
    inputBusy = false;
  }
}

// Send tap as soon as the gesture is known (mousemove past threshold → swipe; else tap on mouseup).
// No extra app delays — remaining latency is USB + WebDriverAgent RTT.
let gestureIsSwipe = false;
canvas.addEventListener('mousedown', (e) => {
  if (isPlaying) return;
  const coords = getPhoneCoordinates(e);
  isDragging = true;
  gestureIsSwipe = false;
  dragStartCoords = coords;
  triggerRipple(coords.rawX, coords.rawY);
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDragging || !dragStartCoords) return;
  const cur = getPhoneCoordinates(e);
  if (Math.abs(cur.x - dragStartCoords.x) > 15 || Math.abs(cur.y - dragStartCoords.y) > 15) {
    gestureIsSwipe = true;
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (!isDragging || isPlaying) return;
  isDragging = false;
  const endCoords = getPhoneCoordinates(e);
  const start = dragStartCoords;
  const isSwipe = gestureIsSwipe
    || Math.abs(endCoords.x - start.x) > 15
    || Math.abs(endCoords.y - start.y) > 15;

  const now = Date.now();
  const delay = lastEventTime ? now - lastEventTime : 0;
  lastEventTime = now;

  enqueueInput(async () => {
    if (isSwipe) {
      const swipeAction = {
        action: 'swipe',
        fromX: start.x,
        fromY: start.y,
        toX: endCoords.x,
        toY: endCoords.y,
        width: canvas.width,
        height: canvas.height,
        duration: 0.12,
        delayMs: delay
      };
      if (isRecording) {
        recordedSteps.push(swipeAction);
        updateStepListUI();
      }
      log(`Swipe (${swipeAction.fromX}, ${swipeAction.fromY}) -> (${swipeAction.toX}, ${swipeAction.toY})`);
      inputBusy = true;
      try {
        await window.electronAPI.sendSwipe(swipeAction);
      } finally {
        inputBusy = false;
      }
    } else {
      // Drop near-duplicate taps before recording / sending
      if (isRapidDuplicateTap(start.x, start.y)) {
        lastGroupedTap = { x: start.x, y: start.y, at: Date.now() };
        log(`Tap merged at (${start.x}, ${start.y})`, 'info');
        return;
      }

      const tapAction = {
        action: 'tap',
        x: start.x,
        y: start.y,
        width: canvas.width,
        height: canvas.height,
        delayMs: delay
      };
      if (isRecording) {
        recordedSteps.push(tapAction);
        updateStepListUI();
      }
      log(`Tap at (${tapAction.x}, ${tapAction.y})`);
      await executeTap(tapAction.x, tapAction.y);
    }
  });
});

// Auto-connect while waiting; once linked, stop connect polls until disconnect
const POLL_MS = 5000;
const HEALTH_MS = 8000;
const linkBtn = document.getElementById('linkBtn');
let linkConnected = false;
let linkBusy = false;
let userPaused = false;
let lastProbeKey = '';
let connectTimer = null;
let healthTimer = null;

function updateLinkButton() {
  if (!linkBtn) return;
  if (linkConnected) {
    linkBtn.hidden = false;
    linkBtn.textContent = 'Disconnect';
    linkBtn.className = 'btn secondary link-btn';
  } else if (userPaused) {
    linkBtn.hidden = false;
    linkBtn.textContent = 'Reconnect';
    linkBtn.className = 'btn primary link-btn';
  } else {
    linkBtn.hidden = true;
  }
}

function stopConnectPolling() {
  if (connectTimer) {
    clearInterval(connectTimer);
    connectTimer = null;
  }
}

function startConnectPolling() {
  if (connectTimer || linkConnected || userPaused) return;
  connectTimer = setInterval(() => {
    if (!linkConnected && !userPaused) tryAutoConnect();
  }, POLL_MS);
}

function stopHealthWatch() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

function startHealthWatch() {
  stopHealthWatch();
  healthTimer = setInterval(checkStillConnected, HEALTH_MS);
}

async function checkStillConnected() {
  if (!linkConnected || linkBusy || userPaused) return;
  try {
    const probe = window.electronAPI.probeDevice
      ? await window.electronAPI.probeDevice()
      : { connected: false };
    if (!probe.connected || !probe.wdaReady) {
      log('Link lost — waiting for iPhone…', 'info');
      becomeWaiting(probe.connected ? deviceLabel(probe) : 'Plug in an iPhone over USB');
    }
  } catch (_) {
    becomeWaiting('Plug in an iPhone over USB');
  }
}

async function becomeConnected(res) {
  const device = res.device || {};
  applyDeviceSize(device.width, device.height, deviceLabel(device));
  setStatus(isRecording ? 'Recording' : 'Connected', isRecording ? 'recording' : 'connected');
  if (!linkConnected) {
    log(`Connected to ${device.name || device.model || 'iPhone'}`, 'success');
  }
  linkConnected = true;
  userPaused = false;
  stopConnectPolling();
  startHealthWatch();
  updateLinkButton();
  await applyStreamSliders(false);
  if (!isAutoStreaming) await startAutoStream();
}

function becomeWaiting(message) {
  const wasConnected = linkConnected;
  linkConnected = false;
  stopHealthWatch();
  if (isAutoStreaming) stopAutoStream();
  if (!isRecording) setStatus(userPaused ? 'Paused' : 'Waiting', 'disconnected');
  setDeviceInfo(message || 'Looking for an iPhone…');
  updateLinkButton();
  if (wasConnected && !userPaused) log('iPhone disconnected — waiting…', 'info');
  if (!userPaused) {
    startConnectPolling();
    // kick sooner than the next interval
    setTimeout(() => {
      if (!linkConnected && !userPaused) tryAutoConnect();
    }, 500);
  }
}

async function tryAutoConnect() {
  if (linkBusy || linkConnected || userPaused) return;
  linkBusy = true;
  const unsub = window.electronAPI.onBootstrapProgress
    ? window.electronAPI.onBootstrapProgress((msg) => log(msg, 'info'))
    : () => {};

  try {
    const probe = window.electronAPI.probeDevice
      ? await window.electronAPI.probeDevice()
      : { connected: false };

    if (!probe.connected) {
      if (!isRecording) setStatus('Waiting', 'disconnected');
      setDeviceInfo('Plug in an iPhone over USB');
      updateLinkButton();
      return;
    }

    const key = `${probe.udid || ''}|${probe.productType || ''}`;
    if (key !== lastProbeKey) {
      lastProbeKey = key;
      setDeviceInfo(deviceLabel(probe));
      if (probe.width && probe.height) {
        applyDeviceSize(probe.width, probe.height, deviceLabel(probe));
      }
    }

    if (!isRecording) setStatus('Connecting…', 'connecting');
    log('iPhone detected — starting session…');
    const res = await window.electronAPI.bootstrapConnect();
    if (res?.success) {
      await becomeConnected(res);
    } else {
      if (!isRecording) setStatus('Waiting', 'disconnected');
      setDeviceInfo(deviceLabel(probe));
      log(`Auto-connect: ${res?.error || 'not ready yet'}`, 'info');
    }
  } catch (err) {
    if (!isRecording) setStatus('Waiting', 'disconnected');
    log(`Auto-connect: ${err.message}`, 'error');
  } finally {
    unsub();
    linkBusy = false;
  }
}

async function disconnectSession() {
  userPaused = true;
  stopConnectPolling();
  stopHealthWatch();
  linkConnected = false;
  if (isAutoStreaming) stopAutoStream();
  if (isRecording) {
    // leave recording flag alone; status still paused for link
  }
  setStatus('Paused', 'disconnected');
  updateLinkButton();
  log('Disconnected — stream paused. Reconnect when ready.', 'info');
}

if (linkBtn) {
  linkBtn.addEventListener('click', async () => {
    if (linkConnected) {
      await disconnectSession();
      return;
    }
    if (userPaused) {
      userPaused = false;
      setStatus('Waiting', 'disconnected');
      updateLinkButton();
      startConnectPolling();
      await tryAutoConnect();
    }
  });
}

setStatus('Waiting', 'disconnected');
setDeviceInfo('Looking for an iPhone…');
updateLinkButton();
tryAutoConnect();
startConnectPolling();

// Recording Handlers
recordBtn.addEventListener('click', () => {
  isRecording = true;
  lastEventTime = null;
  recordBtn.disabled = true;
  stopBtn.disabled = false;
  playBtn.disabled = true;
  setStatus('Recording', 'recording');
  log('Recording — tap or swipe on the phone.');
});

stopBtn.addEventListener('click', () => {
  isRecording = false;
  isPlaying = false;
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  playBtn.disabled = recordedSteps.length === 0;
  setStatus(linkConnected ? 'Connected' : 'Waiting', linkConnected ? 'connected' : 'disconnected');
  log(`Recording stopped. ${recordedSteps.length} steps.`);
});

clearBtn.addEventListener('click', () => {
  recordedSteps = [];
  updateStepListUI();
  playBtn.disabled = true;
  log('Macro steps cleared.');
});

// UI Step List Updates
function updateStepListUI() {
  stepCount.innerText = recordedSteps.length;
  if (recordedSteps.length === 0) {
    stepList.innerHTML = '<div class="empty-state">No steps yet. Record, then tap or swipe on the phone.</div>';
    return;
  }

  stepList.innerHTML = '';
  recordedSteps.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = 'step-item';
    item.id = `step-item-${idx}`;

    const info = document.createElement('div');
    info.className = 'step-info';

    const tag = document.createElement('span');
    tag.className = 'step-tag';
    tag.innerText = step.action.toUpperCase();

    const desc = document.createElement('span');
    desc.innerText = step.action === 'tap'
      ? `(${step.x}, ${step.y})`
      : `(${step.fromX},${step.fromY}) ➔ (${step.toX},${step.toY})`;

    const delay = document.createElement('span');
    delay.className = 'step-delay';
    delay.innerText = `+${step.delayMs}ms`;

    info.appendChild(tag);
    info.appendChild(desc);
    info.appendChild(delay);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-step-btn';
    delBtn.innerText = '✕';
    delBtn.addEventListener('click', () => {
      recordedSteps.splice(idx, 1);
      updateStepListUI();
      playBtn.disabled = recordedSteps.length === 0;
    });

    item.appendChild(info);
    item.appendChild(delBtn);
    stepList.appendChild(item);
  });
}

// Replay Engine
playBtn.addEventListener('click', async () => {
  if (recordedSteps.length === 0 || isPlaying) return;
  isPlaying = true;
  recordBtn.disabled = true;
  playBtn.disabled = true;
  stopBtn.disabled = false;

  const loopTarget = infiniteLoopCheckbox.checked ? Infinity : parseInt(loopCountInput.value) || 1;
  const loopDelay = parseInt(loopDelayInput.value) || 500;

  log(`Starting replay: ${loopTarget === Infinity ? 'Infinite' : loopTarget + ' iterations'}`);

  let currentLoop = 0;
  while (isPlaying && currentLoop < loopTarget) {
    currentLoop++;
    log(`--- Running Iteration #${currentLoop} ---`);

    for (let i = 0; i < recordedSteps.length; i++) {
      if (!isPlaying) break;

      const step = recordedSteps[i];

      // Highlight active UI step
      document.querySelectorAll('.step-item').forEach(el => el.classList.remove('executing'));
      const activeEl = document.getElementById(`step-item-${i}`);
      if (activeEl) {
        activeEl.classList.add('executing');
        activeEl.scrollIntoView({ block: 'nearest' });
      }

      // Wait recorded delay
      const waitTime = i === 0 ? 100 : Math.min(step.delayMs, 5000);
      await new Promise(r => setTimeout(r, waitTime));

      if (!isPlaying) break;

      // Execute Action
      if (step.action === 'tap') {
        const rect = canvas.getBoundingClientRect();
        const rx = (step.x / canvas.width) * rect.width;
        const ry = (step.y / canvas.height) * rect.height;
        triggerRipple(rx, ry);
        await executeTap(step.x, step.y);
      } else if (step.action === 'swipe') {
        await window.electronAPI.sendSwipe(step);
      }
    }

    if (isPlaying && currentLoop < loopTarget) {
      await new Promise(r => setTimeout(r, loopDelay));
    }
  }

  document.querySelectorAll('.step-item').forEach(el => el.classList.remove('executing'));
  isPlaying = false;
  recordBtn.disabled = false;
  playBtn.disabled = false;
  stopBtn.disabled = true;
  log('Macro playback completed.', 'success');
});

// JSON Export & Import
exportBtn.addEventListener('click', () => {
  if (recordedSteps.length === 0) return alert('No recorded steps to export!');
  const blob = new Blob([JSON.stringify(recordedSteps, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ios_macro_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  log('Macro exported to JSON file.', 'success');
});

importBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (Array.isArray(data)) {
        recordedSteps = data;
        updateStepListUI();
        playBtn.disabled = false;
        log(`Loaded ${recordedSteps.length} steps from JSON file.`, 'success');
      } else {
        alert('Invalid macro file format.');
      }
    } catch (err) {
      alert('Failed to parse JSON file.');
    }
  };
  reader.readAsText(file);
});
