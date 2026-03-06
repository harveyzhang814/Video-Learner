const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runPipeline: (options) => ipcRenderer.invoke('run-pipeline', options),
  stopPipeline: (id) => ipcRenderer.invoke('stop-pipeline', id),
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
  runStep: (id, step, options) => ipcRenderer.invoke('run-step', { id, step, options }),
  retryStep: (id, step) => ipcRenderer.invoke('retry-step', { id, step }),
  skipStep: (id, step) => ipcRenderer.invoke('skip-step', { id, step }),
  getTaskStatus: (id) => ipcRenderer.invoke('get-task-status', id),
  getTaskDetails: (id) => ipcRenderer.invoke('get-task-details', id),
  updateTaskDetails: (id, data) => ipcRenderer.invoke('update-task-details', { id, data }),
  onOutput: (callback) => {
    ipcRenderer.on('pipeline-output', (event, text) => callback(text));
  },
  onTaskCreated: (callback) => {
    ipcRenderer.on('task-created', (event, task) => callback(task));
  },
  onTaskUpdated: (callback) => {
    ipcRenderer.on('task-updated', (event, task) => callback(task));
  }
});
