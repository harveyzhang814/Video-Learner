const { contextBridge, ipcRenderer } = require('electron');

// Expose the same API shape that tests expect via preload-helpers,
// but inline here to avoid any module resolution issues at runtime.
contextBridge.exposeInMainWorld('service', Object.freeze({
  getServiceInfo: () => ipcRenderer.invoke('service:getInfo')
}));

// Electron-specific helper for opening the current task folder.
contextBridge.exposeInMainWorld('electron', Object.freeze({
  openTaskFolder: (taskId) => ipcRenderer.invoke('open-task-folder', taskId)
}));
