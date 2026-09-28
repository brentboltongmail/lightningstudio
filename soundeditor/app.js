let audioCtx;
let audioBuffer;
let audioEl;
let mediaSourceNode;
let streamDestination;
let gainNode;
let lowEQ, midEQ, highEQ;
let compressor;
let analyserFreq, analyserDyn;

let isPlaying = false;
let startTime = 0;
let pauseTime = 0;
let animationId;

// Trim State (0 to 1 ratios)
let trimStartRatio = 0;
let trimEndRatio = 1;

// DOM Elements
const canvasWave = document.getElementById('waveform-canvas');
const ctxWave = canvasWave.getContext('2d');
const canvasFreq = document.getElementById('freq-canvas');
const ctxFreq = canvasFreq.getContext('2d');
const canvasDyn = document.getElementById('dynamics-canvas');
const ctxDyn = canvasDyn.getContext('2d');

const playhead = document.getElementById('playhead');
const timeStart = document.getElementById('time-start');
const timeEnd = document.getElementById('time-end');

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    audioEl = new Audio();
    audioEl.crossOrigin = "anonymous";
    mediaSourceNode = audioCtx.createMediaElementSource(audioEl);
    streamDestination = audioCtx.createMediaStreamDestination();

    // Nodes
    gainNode = audioCtx.createGain();
    
    lowEQ = audioCtx.createBiquadFilter();
    lowEQ.type = 'lowshelf';
    lowEQ.frequency.value = 320;
    
    midEQ = audioCtx.createBiquadFilter();
    midEQ.type = 'peaking';
    midEQ.frequency.value = 1000;
    midEQ.Q.value = 0.5;
    
    highEQ = audioCtx.createBiquadFilter();
    highEQ.type = 'highshelf';
    highEQ.frequency.value = 3200;
    
    compressor = audioCtx.createDynamicsCompressor();
    
    analyserFreq = audioCtx.createAnalyser();
    analyserFreq.fftSize = 256;
    
    analyserDyn = audioCtx.createAnalyser();
    analyserDyn.fftSize = 2048;

    // Routing
    mediaSourceNode.connect(lowEQ);
    lowEQ.connect(midEQ);
    midEQ.connect(highEQ);
    highEQ.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(analyserFreq);
    analyserFreq.connect(analyserDyn);
    analyserDyn.connect(audioCtx.destination);
    gainNode.connect(streamDestination);

    audioEl.ontimeupdate = () => {
      if (audioBuffer && audioEl.currentTime >= audioBuffer.duration * trimEndRatio) {
        stopPlayback();
      }
    };
    audioEl.onended = stopPlayback;
  }
}


document.getElementById('audio-upload').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  initAudio();
  if(audioCtx.state === 'suspended') await audioCtx.resume();
  
  if (audioEl.src) URL.revokeObjectURL(audioEl.src);
  audioEl.src = URL.createObjectURL(file);
  
  const arrayBuffer = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  
  trimStartRatio = 0;
  trimEndRatio = 1;
  updateTrimUI();
  drawWaveform();
  timeStart.textContent = '0.00s';
  timeEnd.textContent = audioBuffer.duration.toFixed(2) + 's';
});

document.getElementById('btn-play').addEventListener('click', () => {
  if (!audioBuffer) return;
  initAudio();
  
  if (isPlaying) {
    stopPlayback();
  }
  
  const rate = parseFloat(document.getElementById('ctrl-rate').value);
  audioEl.playbackRate = rate;
  audioEl.preservesPitch = document.getElementById('cb-keep-pitch').checked;
  
  const startOffset = audioBuffer.duration * trimStartRatio;
  audioEl.currentTime = startOffset;
  audioEl.play();
  
  isPlaying = true;
  playhead.classList.remove('hidden');
  visualize();
});

document.getElementById('btn-stop').addEventListener('click', stopPlayback);

function stopPlayback() {
  if (isPlaying) {
    audioEl.pause();
    isPlaying = false;
    playhead.classList.add('hidden');
    cancelAnimationFrame(animationId);
  }
}

function drawWaveform() {
  if (!audioBuffer) return;
  canvasWave.width = canvasWave.clientWidth;
  canvasWave.height = canvasWave.clientHeight;
  
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / canvasWave.width);
  const amp = canvasWave.height / 2;
  
  ctxWave.clearRect(0, 0, canvasWave.width, canvasWave.height);
  ctxWave.fillStyle = '#38bdf8';
  
  for(let i=0; i<canvasWave.width; i++){
    let min = 1.0, max = -1.0;
    for(let j=0; j<step; j++){
      const datum = data[(i*step)+j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    ctxWave.fillRect(i, (1+min)*amp, 1, Math.max(1, (max-min)*amp));
  }
}

function visualize() {
  if(!isPlaying) return;
  
  // Frequency
  canvasFreq.width = canvasFreq.clientWidth;
  canvasFreq.height = canvasFreq.clientHeight;
  const fData = new Uint8Array(analyserFreq.frequencyBinCount);
  analyserFreq.getByteFrequencyData(fData);
  
  ctxFreq.clearRect(0, 0, canvasFreq.width, canvasFreq.height);
  const barWidth = (canvasFreq.width / fData.length) * 2.5;
  let x = 0;
  for(let i = 0; i < fData.length; i++) {
    const barHeight = (fData[i] / 255) * canvasFreq.height;
    ctxFreq.fillStyle = `hsl(${i/fData.length * 200 + 150}, 100%, 50%)`;
    ctxFreq.fillRect(x, canvasFreq.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
  
  // Dynamics (Oscilloscope)
  canvasDyn.width = canvasDyn.clientWidth;
  canvasDyn.height = canvasDyn.clientHeight;
  const dData = new Uint8Array(analyserDyn.fftSize);
  analyserDyn.getByteTimeDomainData(dData);
  
  ctxDyn.clearRect(0, 0, canvasDyn.width, canvasDyn.height);
  ctxDyn.lineWidth = 2;
  ctxDyn.strokeStyle = '#a855f7';
  ctxDyn.beginPath();
  const sliceWidth = canvasDyn.width * 1.0 / dData.length;
  let dx = 0;
  for(let i=0; i < dData.length; i++) {
    const v = dData[i] / 128.0;
    const y = v * canvasDyn.height / 2;
    if(i===0) ctxDyn.moveTo(dx, y);
    else ctxDyn.lineTo(dx, y);
    dx += sliceWidth;
  }
  ctxDyn.lineTo(canvasDyn.width, canvasDyn.height/2);
  ctxDyn.stroke();

  // Playhead update
  if(audioBuffer && audioEl) {
    const pct = audioEl.currentTime / audioBuffer.duration;
    if (pct <= trimEndRatio) {
      playhead.style.left = (pct * 100) + '%';
    }
  }

  animationId = requestAnimationFrame(visualize);
}

// Bind Controls
function bindControl(id, nodeField, labelId, suffix = '') {
  const el = document.getElementById(id);
  el.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.getElementById(labelId).textContent = val + suffix;
    if(nodeField && nodeField.value !== undefined) {
      nodeField.value = val;
    }
  });
}

setTimeout(() => {
  document.getElementById('ctrl-rate').addEventListener('input', (e) => {
    document.getElementById('val-rate').textContent = e.target.value + 'x';
    if(audioEl) audioEl.playbackRate = parseFloat(e.target.value);
  });
  document.getElementById('cb-keep-pitch').addEventListener('change', (e) => {
    if(audioEl) audioEl.preservesPitch = e.target.checked;
  });
  document.getElementById('ctrl-vol').addEventListener('input', (e) => {
    document.getElementById('val-vol').textContent = e.target.value;
    if(gainNode) gainNode.gain.value = parseFloat(e.target.value);
  });
  
  document.getElementById('ctrl-eq-low').addEventListener('input', (e) => {
    document.getElementById('val-eq-low').textContent = e.target.value + ' dB';
    if(lowEQ) lowEQ.gain.value = parseFloat(e.target.value);
  });
  document.getElementById('ctrl-eq-mid').addEventListener('input', (e) => {
    document.getElementById('val-eq-mid').textContent = e.target.value + ' dB';
    if(midEQ) midEQ.gain.value = parseFloat(e.target.value);
  });
  document.getElementById('ctrl-eq-high').addEventListener('input', (e) => {
    document.getElementById('val-eq-high').textContent = e.target.value + ' dB';
    if(highEQ) highEQ.gain.value = parseFloat(e.target.value);
  });

  document.getElementById('ctrl-comp-thresh').addEventListener('input', (e) => {
    document.getElementById('val-comp-thresh').textContent = e.target.value + ' dB';
    if(compressor) compressor.threshold.value = parseFloat(e.target.value);
  });
  document.getElementById('ctrl-comp-ratio').addEventListener('input', (e) => {
    document.getElementById('val-comp-ratio').textContent = e.target.value + ':1';
    if(compressor) compressor.ratio.value = parseFloat(e.target.value);
  });
  document.getElementById('ctrl-comp-attack').addEventListener('input', (e) => {
    document.getElementById('val-comp-attack').textContent = e.target.value + ' s';
    if(compressor) compressor.attack.value = parseFloat(e.target.value);
  });
  document.getElementById('ctrl-comp-release').addEventListener('input', (e) => {
    document.getElementById('val-comp-release').textContent = e.target.value + ' s';
    if(compressor) compressor.release.value = parseFloat(e.target.value);
  });

}, 100);

// Simple Trim UI drag logic
const tStart = document.getElementById('trim-start');
const tEnd = document.getElementById('trim-end');
const container = document.getElementById('waveform-container');

let activeHandle = null;

tStart.addEventListener('mousedown', () => activeHandle = 'start');
tEnd.addEventListener('mousedown', () => activeHandle = 'end');
window.addEventListener('mouseup', () => activeHandle = null);

window.addEventListener('mousemove', (e) => {
  if (!activeHandle || !audioBuffer) return;
  const rect = container.getBoundingClientRect();
  let pct = (e.clientX - rect.left) / rect.width;
  pct = Math.max(0, Math.min(1, pct));
  
  if (activeHandle === 'start') {
    trimStartRatio = Math.min(pct, trimEndRatio - 0.01);
  } else {
    trimEndRatio = Math.max(pct, trimStartRatio + 0.01);
  }
  updateTrimUI();
});

function updateTrimUI() {
  tStart.style.left = (trimStartRatio * 100) + '%';
  tEnd.style.left = (trimEndRatio * 100) + '%';
  
  if (audioBuffer) {
    timeStart.textContent = (audioBuffer.duration * trimStartRatio).toFixed(2) + 's';
    timeEnd.textContent = (audioBuffer.duration * trimEndRatio).toFixed(2) + 's';
  }
}

document.getElementById('btn-export').addEventListener('click', async () => {
  if (!audioBuffer) return alert('Load an audio file first!');
  if (isPlaying) stopPlayback();
  
  const startOffset = audioBuffer.duration * trimStartRatio;
  const duration = (audioBuffer.duration * trimEndRatio) - startOffset;
  if (duration <= 0) return alert('Invalid trim region.');
  
  const btn = document.getElementById('btn-export');
  btn.textContent = 'Recording MP3...';
  btn.classList.add('opacity-50');
  
  initAudio();
  
  const rate = parseFloat(document.getElementById('ctrl-rate').value);
  audioEl.playbackRate = rate;
  audioEl.preservesPitch = document.getElementById('cb-keep-pitch').checked;
  audioEl.currentTime = startOffset;
  
  const chunks = [];
  const recorder = new MediaRecorder(streamDestination.stream);
  recorder.ondataavailable = e => chunks.push(e.data);
  
  recorder.onstop = async () => {
    btn.textContent = 'Encoding MP3...';
    try {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const arrayBuf = await blob.arrayBuffer();
      
      const offlineCtx = new (window.AudioContext || window.webkitAudioContext)();
      const decodedBuffer = await offlineCtx.decodeAudioData(arrayBuf);
      offlineCtx.close();
      
      const mp3Encoder = new lamejs.Mp3Encoder(decodedBuffer.numberOfChannels, decodedBuffer.sampleRate, 128);
      const mp3Data = [];
      const sampleBlockSize = 1152;
      
      const left = decodedBuffer.getChannelData(0);
      const right = decodedBuffer.numberOfChannels > 1 ? decodedBuffer.getChannelData(1) : left;
      
      const floatToInt16 = (f32Arr) => {
        const i16 = new Int16Array(f32Arr.length);
        for(let i=0; i<f32Arr.length; i++) {
          let s = Math.max(-1, Math.min(1, f32Arr[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return i16;
      };
      
      const left16 = floatToInt16(left);
      const right16 = floatToInt16(right);
      
      for (let i = 0; i < left16.length; i += sampleBlockSize) {
        const leftChunk = left16.subarray(i, i + sampleBlockSize);
        const rightChunk = right16.subarray(i, i + sampleBlockSize);
        const mp3buf = mp3Encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) mp3Data.push(mp3buf);
      }
      const mp3buf = mp3Encoder.flush();
      if (mp3buf.length > 0) mp3Data.push(mp3buf);
      
      const mp3Blob = new Blob(mp3Data, { type: 'audio/mpeg' });
      
      try {
        if (window.showSaveFilePicker) {
          const handle = await window.showSaveFilePicker({
            suggestedName: 'audiostudio_export.mp3',
            types: [{
              description: 'MP3 Audio',
              accept: { 'audio/mpeg': ['.mp3'] },
            }],
          });
          const writable = await handle.createWritable();
          await writable.write(mp3Blob);
          await writable.close();
        } else {
          // Fallback for unsupported browsers
          const url = URL.createObjectURL(mp3Blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'audiostudio_export.mp3';
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
          alert('Save failed: ' + err.message);
        }
      }
      
    } catch(err) {
      console.error(err);
      alert('MP3 Encoding Failed: ' + err.message);
    }
    btn.textContent = 'Export';
    btn.classList.remove('opacity-50');
  };
  
  recorder.start();
  audioEl.play();
  isPlaying = true;
  playhead.classList.remove('hidden');
  visualize();
  
  const checkStop = setInterval(() => {
    if (!isPlaying && recorder.state === 'recording') {
      recorder.stop();
      clearInterval(checkStop);
    }
  }, 100);
});

window.addEventListener('resize', drawWaveform);

document.getElementById('btn-reset').addEventListener('click', () => {
  if(isPlaying) stopPlayback();

  // Reset Trim
  trimStartRatio = 0;
  trimEndRatio = 1;
  updateTrimUI();

  // Reset controls
  const setControl = (id, val) => {
    const el = document.getElementById(id);
    if(el) {
      el.value = val;
      el.dispatchEvent(new Event('input'));
    }
  };

  setControl('ctrl-rate', 1.0);
  const cbPitch = document.getElementById('cb-keep-pitch');
  if(cbPitch) {
    cbPitch.checked = true;
    cbPitch.dispatchEvent(new Event('change'));
  }
  setControl('ctrl-vol', 1.0);
  
  setControl('ctrl-eq-low', 0);
  setControl('ctrl-eq-mid', 0);
  setControl('ctrl-eq-high', 0);
  
  setControl('ctrl-comp-thresh', -24);
  setControl('ctrl-comp-ratio', 12);
  setControl('ctrl-comp-attack', 0.003);
  setControl('ctrl-comp-release', 0.25);
});
