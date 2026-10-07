const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setWdaUrl: (url) => ipcRenderer.invoke('set-wda-url', url),
  checkDeviceStatus: () => ipcRenderer.invoke('check-device-status'),
  probeDevice: () => ipcRenderer.invoke('probe-device'),
  bootstrapConnect: () => ipcRenderer.invoke('bootstrap-connect'),
  onBootstrapProgress: (cb) => {
    const handler = (_event, msg) => cb(msg);
    ipcRenderer.on('bootstrap-progress', handler);
    return () => ipcRenderer.removeListener('bootstrap-progress', handler);
  },
  getWindowSize: () => ipcRenderer.invoke('get-window-size'),
  configureStream: (opts) => ipcRenderer.invoke('configure-stream', opts),
  sendMove: (coords) => ipcRenderer.invoke('send-move', coords),
  sendTap: (coords) => ipcRenderer.invoke('send-tap', coords),
  sendSwipe: (gesture) => ipcRenderer.invoke('send-swipe', gesture),
  fetchLiveScreen: () => ipcRenderer.invoke('fetch-live-screen')
});
