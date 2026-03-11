const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const helpers = require('./main-helpers');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelMap = { 0: 'debug', 1: 'info', 2: 'warn', 3: 'error' };
    const levelName = levelMap[level] || 'log';
    if (message) console.log(`[Renderer ${levelName}] ${message}`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Renderer] Process gone:', details.reason);
  });
}

app.whenReady().then(async () => {
  try {
    await helpers.startLocalHttpService();
  } catch (e) {
    console.error('[agent-http] failed to start', e && e.message ? e.message : e);
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  helpers.stopLocalHttpService();
});

ipcMain.handle('service:getInfo', async () => {
  const info = helpers.getHttpServiceInfo();
  if (info) return { ...info };
  const started = await helpers.startLocalHttpService();
  return { ...started };
});
