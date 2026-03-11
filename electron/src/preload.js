const { contextBridge, ipcRenderer } = require('electron');

// Read-only service discovery API
contextBridge.exposeInMainWorld('service', Object.freeze({
  getServiceInfo: () => ipcRenderer.invoke('service:getInfo')
}));
