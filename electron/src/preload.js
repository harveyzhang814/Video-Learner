const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runPipeline: (options) => ipcRenderer.invoke('run-pipeline', options),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', { filePath, content }),
  listWorks: () => ipcRenderer.invoke('list-works'),
  deleteWork: (id) => ipcRenderer.invoke('delete-work', id),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  getVideoPath: (id) => ipcRenderer.invoke('get-video-path', id),
  getMediaPath: (id) => ipcRenderer.invoke('get-media-path', id),
  getSubtitlePath: (id) => ipcRenderer.invoke('get-subtitle-path', id),
  readSubtitle: (id) => ipcRenderer.invoke('read-subtitle', id),
  readSubtitleBilingual: (id, lang) => ipcRenderer.invoke('read-subtitle-bilingual', { id, lang }),
  getAvailableSubtitles: (id) => ipcRenderer.invoke('get-available-subtitles', id),
  resetTaskStep: (id, step) => ipcRenderer.invoke('reset-task-step', { id, step }),
  onOutput: (callback) => {
    ipcRenderer.on('pipeline-output', (event, text) => callback(text));
  }
});
