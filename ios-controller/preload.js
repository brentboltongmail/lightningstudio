const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setWdaUrl: (url) => ipcRenderer.invoke('set-wda-url', url),
  checkDeviceStatus: () => ipcRenderer.invoke('check-device-status'),
  sendTap: (coords) => ipcRenderer.invoke('send-tap', coords),
  sendSwipe: (gesture) => ipcRenderer.invoke('send-swipe', gesture),
  fetchLiveScreen: () => ipcRenderer.invoke('fetch-live-screen')
});
