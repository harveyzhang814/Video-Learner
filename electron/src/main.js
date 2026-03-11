const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const baseDir = path.resolve(__dirname, '..', '..');

let mainWindow;

let httpServiceProcess = null;
let httpServiceInfo = null; // { baseUrl, token }

function sanitizeLogLine(line) {
  if (!line) return '';
  // Avoid leaking any token-like query string in logs.
  return String(line).replace(/\?token=[^&\s]+/g, '?token=[REDACTED]');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      server.close(() => resolve(port));
    });
  });
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch (e) {
            reject(e);
          }
          return;
        }
        reject(new Error(`HTTP ${res.statusCode || 0}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function waitForServiceReady({ baseUrl, timeoutMs = 8000 }) {
  const startedAt = Date.now();
  const stepTimeoutMs = 500;
  let lastErr = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const { body } = await httpGetJson(`${baseUrl}/healthz`, stepTimeoutMs);
      if (body && body.ok === true) return;
      lastErr = new Error('healthz not ok');
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw lastErr || new Error('service not ready');
}

async function startLocalHttpService() {
  if (httpServiceProcess && httpServiceInfo) return httpServiceInfo;

  const port = await getFreePort();
  if (!port) throw new Error('failed to allocate free port');

  const token = crypto.randomBytes(24).toString('hex');
  const entry = path.join(baseDir, 'services', 'http-server', 'index.js');
  const baseUrl = `http://127.0.0.1:${port}`;

  const childEnv = {
    ...process.env,
    PORT: String(port),
    AGENT_EVENTS_TOKEN: token
  };

  // NOTE: Do not use Electron's embedded Node runtime here; we rely on native
  // modules (e.g. better-sqlite3) compiled for the system Node ABI.
  httpServiceProcess = spawn('node', [entry], {
    cwd: baseDir,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  httpServiceInfo = { baseUrl, token };

  httpServiceProcess.stdout.on('data', (buf) => {
    const line = sanitizeLogLine(buf.toString('utf8'));
    if (line.trim()) console.log(`[agent-http] ${line.trimEnd()}`);
  });
  httpServiceProcess.stderr.on('data', (buf) => {
    const line = sanitizeLogLine(buf.toString('utf8'));
    if (line.trim()) console.warn(`[agent-http] ${line.trimEnd()}`);
  });
  httpServiceProcess.on('exit', (code, signal) => {
    console.warn('[agent-http] exited', { code, signal });
    httpServiceProcess = null;
    httpServiceInfo = null;
  });

  await waitForServiceReady({ baseUrl, timeoutMs: 12000 });
  console.log('[agent-http] ready', { baseUrl });
  return httpServiceInfo;
}

function stopLocalHttpService() {
  if (!httpServiceProcess) return;
  try {
    httpServiceProcess.kill('SIGTERM');
  } catch (_) {
    // ignore
  } finally {
    httpServiceProcess = null;
    httpServiceInfo = null;
  }
}

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

  // 捕获渲染进程的 console 消息 (旧 API，有警告但兼容性好)
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levelMap = { 0: 'debug', 1: 'info', 2: 'warn', 3: 'error' };
    const levelName = levelMap[level] || 'log';
    if (message) console.log(`[Renderer ${levelName}] ${message}`);
  });

  // 捕获渲染进程未处理的错误
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Renderer] Process gone:', details.reason);
  });
}

app.whenReady().then(async () => {
  try {
    await startLocalHttpService();
  } catch (e) {
    console.error('[agent-http] failed to start', e && e.message ? e.message : e);
    // Continue booting Electron even if service failed; renderer can surface error.
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
  stopLocalHttpService();
});

ipcMain.handle('service:getInfo', async () => {
  // Do NOT log token.
  if (httpServiceInfo) return { ...httpServiceInfo };
  // Try to lazily start if it wasn't started successfully at boot.
  const info = await startLocalHttpService();
  return { ...info };
});
