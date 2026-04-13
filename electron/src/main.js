const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const helpers = require('./main-helpers');

let mainWindow;

// 将 renderer console 写入项目内文件，便于排查（agent 可直接 read_file）
const RENDERER_LOG_PATH = path.join(__dirname, '..', 'renderer-console.log');

function createWindow() {
  try {
    fs.writeFileSync(RENDERER_LOG_PATH, `[${new Date().toISOString()}] Electron launch, log started\n`, 'utf8');
  } catch (_) {}

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
    if (message) {
      console.log(`[Renderer ${levelName}] ${message}`);
      try {
        fs.appendFileSync(RENDERER_LOG_PATH, `[${new Date().toISOString()}] [${levelName}] ${message}\n`, 'utf8');
      } catch (_) {}
    }
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

ipcMain.handle('open-task-folder', async (_event, taskId) => {
  try {
    const info = helpers.getHttpServiceInfo() || await helpers.startLocalHttpService();
    if (!info || !info.baseUrl) {
      return { ok: false, error: 'HTTP service not available' };
    }

    const url = new URL(`/api/tasks/${encodeURIComponent(taskId)}/paths`, info.baseUrl);
    const res = await fetch(url.toString(), {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${info.token}` }
    });

    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText || 'failed to get task paths';
      try {
        const data = text ? JSON.parse(text) : null;
        if (data && data.error) msg = data.error;
      } catch (_) {
        // ignore JSON parse error, keep default msg
      }
      return { ok: false, error: msg };
    }

    const body = await res.json();
    const base = body && typeof body.base === 'string' ? body.base : null;
    if (!base) {
      return { ok: false, error: 'No base path returned for task' };
    }

    const result = await shell.openPath(base);
    if (result) {
      return { ok: false, error: result };
    }

    return { ok: true };
  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Failed to open task folder';
    return { ok: false, error: msg };
  }
});

ipcMain.handle('service:getInfo', async () => {
  const info = helpers.getHttpServiceInfo();
  if (info) return { ...info };
  try {
    const started = await helpers.startLocalHttpService();
    return { ...started };
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    console.error('[agent-http] getInfo start failed:', msg);
    return { error: msg };
  }
});
