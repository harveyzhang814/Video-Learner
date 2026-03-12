const { contextBridge, ipcRenderer } = require('electron');

// Inlined so preload works in Electron's sandbox (no require of local files)
contextBridge.exposeInMainWorld('service', Object.freeze({
  getServiceInfo: () => ipcRenderer.invoke('service:getInfo')
}));
