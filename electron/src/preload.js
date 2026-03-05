const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runPipeline: (options) => ipcRenderer.invoke('run-pipeline', options),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  listWorks: () => ipcRenderer.invoke('list-works'),
  deleteWork: (id) => ipcRenderer.invoke('delete-work', id),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  getVideoPath: (id) => ipcRenderer.invoke('get-video-path', id),
  getSubtitlePath: (id) => ipcRenderer.invoke('get-subtitle-path', id),
  readSubtitle: (id) => ipcRenderer.invoke('read-subtitle', id),
  readSubtitleBilingual: (id, lang) => ipcRenderer.invoke('read-subtitle-bilingual', { id, lang }),
  getAvailableSubtitles: (id) => ipcRenderer.invoke('get-available-subtitles', id),
  onOutput: (callback) => {
    ipcRenderer.on('pipeline-output', (event, text) => callback(text));
  }
});
