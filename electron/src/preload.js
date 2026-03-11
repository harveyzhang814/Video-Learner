const { contextBridge, ipcRenderer } = require('electron');
const { registerPreloadApis } = require('./preload-helpers');

registerPreloadApis({ contextBridge, ipcRenderer });
