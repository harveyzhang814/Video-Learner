const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const crypto = require('crypto');

const baseDir = path.resolve(__dirname, '..', '..');

let httpServiceProcess = null;
let httpServiceInfo = null; // { baseUrl, token }

function sanitizeLogLine(line) {
  if (!line) return '';
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

function getHttpServiceInfo() {
  return httpServiceInfo ? { ...httpServiceInfo } : null;
}

module.exports = {
  sanitizeLogLine,
  getFreePort,
  waitForServiceReady,
  startLocalHttpService,
  stopLocalHttpService,
  getHttpServiceInfo,
};
