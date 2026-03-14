function registerPreloadApis({ contextBridge, ipcRenderer }) {
  contextBridge.exposeInMainWorld('service', Object.freeze({
    getServiceInfo: () => ipcRenderer.invoke('service:getInfo')
  }));
}

module.exports = { registerPreloadApis };
