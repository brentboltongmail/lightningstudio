// DOM Elements
const canvas = document.getElementById('screenCanvas');
const ctx = canvas.getContext('2d');
const screenWrapper = document.getElementById('screenWrapper');
const coordDisplay = document.getElementById('coordDisplay');
const statusBadge = document.getElementById('statusBadge');
const touchRipple = document.getElementById('touchRipple');
const devicePreset = document.getElementById('devicePreset');
const wdaUrlInput = document.getElementById('wdaUrlInput');
const connectBtn = document.getElementById('connectBtn');
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

// Fallback mock if running in a regular web browser instead of Electron
if (!window.electronAPI) {
  window.electronAPI = {
    setWdaUrl: async (url) => ({ status: 'ok', url }),
    checkDeviceStatus: async () => ({ success: false, error: 'Running in browser preview mode (WDA bridge inactive)' }),
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

initCanvas();

const refreshScreenBtn = document.getElementById('refreshScreenBtn');

async function renderScreenImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(true);
    };
    img.src = src;
  });
}

// Initial check for current_screen.png
renderScreenImage('current_screen.png?t=' + Date.now()).catch(() => {});

// Live Screen Refresh Button
if (refreshScreenBtn) {
  refreshScreenBtn.innerText = '📷 Capture Live iPhone Screen';
  refreshScreenBtn.addEventListener('click', async () => {
    log('Fetching current screen from iPhone over USB...');
    refreshScreenBtn.disabled = true;
    try {
      if (window.electronAPI && window.electronAPI.fetchLiveScreen) {
        const res = await window.electronAPI.fetchLiveScreen();
        if (res.success && res.base64) {
          await renderScreenImage(res.base64);
          log('Live iPhone screen updated successfully!', 'success');
        } else {
          log('Screen capture response: ' + (res.error || 'fallback loaded'), 'error');
          await renderScreenImage('current_screen.png?t=' + Date.now());
        }
      } else {
        await renderScreenImage('current_screen.png?t=' + Date.now());
        log('Screen refreshed from USB storage.', 'success');
      }
    } catch (e) {
      log('Failed to capture screen: ' + e.message, 'error');
    } finally {
      refreshScreenBtn.disabled = false;
    }
  });
}

// Handle preset resolution switch
devicePreset.addEventListener('change', (e) => {
  const [w, h] = e.target.value.split('x').map(Number);
  initCanvas(w, h);
  log(`Screen resolution set to ${w} × ${h}`);
});

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

// Coordinate tracker on hover
canvas.addEventListener('mousemove', (e) => {
  const { x, y } = getPhoneCoordinates(e);
  coordDisplay.innerText = `X: ${x}, Y: ${y}`;
});

// Canvas Interaction: Mouse Down
canvas.addEventListener('mousedown', (e) => {
  if (isPlaying) return;
  const coords = getPhoneCoordinates(e);
  isDragging = true;
  dragStartCoords = coords;
  triggerRipple(coords.rawX, coords.rawY);
});

// Canvas Interaction: Mouse Up
canvas.addEventListener('mouseup', async (e) => {
  if (!isDragging || isPlaying) return;
  isDragging = false;
  const endCoords = getPhoneCoordinates(e);

  const deltaX = Math.abs(endCoords.x - dragStartCoords.x);
  const deltaY = Math.abs(endCoords.y - dragStartCoords.y);

  const now = Date.now();
  const delay = lastEventTime ? now - lastEventTime : 0;
  lastEventTime = now;

  // If moved more than 15px, treat as Swipe / Drag; else single Tap
  if (deltaX > 15 || deltaY > 15) {
    const swipeAction = {
      action: 'swipe',
      fromX: dragStartCoords.x,
      fromY: dragStartCoords.y,
      toX: endCoords.x,
      toY: endCoords.y,
      duration: 0.35,
      delayMs: delay
    };

    if (isRecording) {
      recordedSteps.push(swipeAction);
      updateStepListUI();
    }

    log(`Swipe (${swipeAction.fromX}, ${swipeAction.fromY}) -> (${swipeAction.toX}, ${swipeAction.toY})`);
    await window.electronAPI.sendSwipe(swipeAction);
  } else {
    const tapAction = {
      action: 'tap',
      x: dragStartCoords.x,
      y: dragStartCoords.y,
      delayMs: delay
    };

    if (isRecording) {
      recordedSteps.push(tapAction);
      updateStepListUI();
    }

    log(`Tap at (${tapAction.x}, ${tapAction.y})`);
    await window.electronAPI.sendTap(tapAction);
  }
});

// Connection Handlers
connectBtn.addEventListener('click', async () => {
  const url = wdaUrlInput.value.trim();
  log(`Connecting to WDA daemon at ${url}...`);
  await window.electronAPI.setWdaUrl(url);
  const res = await window.electronAPI.checkDeviceStatus();

  if (res.success) {
    statusBadge.innerText = 'Connected';
    statusBadge.className = 'badge connected';
    log('Successfully connected to iOS automation runner!', 'success');
  } else {
    statusBadge.innerText = 'Disconnected';
    statusBadge.className = 'badge disconnected';
    log(`Connection warning: ${res.error}. Simulated execution available.`, 'error');
  }
});

// Recording Handlers
recordBtn.addEventListener('click', () => {
  isRecording = true;
  lastEventTime = null;
  recordBtn.disabled = true;
  stopBtn.disabled = false;
  playBtn.disabled = true;
  statusBadge.innerText = 'Recording';
  statusBadge.className = 'badge recording';
  log('Macro recording started. Click or swipe on screen.');
});

stopBtn.addEventListener('click', () => {
  isRecording = false;
  isPlaying = false;
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  playBtn.disabled = recordedSteps.length === 0;
  statusBadge.innerText = 'Connected';
  statusBadge.className = 'badge connected';
  log(`Recording stopped. Total steps: ${recordedSteps.length}`);
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
    stepList.innerHTML = '<div class="empty-state">No steps recorded yet. Click "Record" and tap/swipe on the phone screen.</div>';
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
        await window.electronAPI.sendTap(step);
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
