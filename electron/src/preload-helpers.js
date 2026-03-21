function registerPreloadApis({ contextBridge, ipcRenderer }) {
  contextBridge.exposeInMainWorld('service', Object.freeze({
    getServiceInfo: () => ipcRenderer.invoke('service:getInfo')
  }));

  contextBridge.exposeInMainWorld('electron', Object.freeze({
    openTaskFolder: (taskId) => ipcRenderer.invoke('open-task-folder', taskId)
  }));
}

module.exports = { registerPreloadApis };
