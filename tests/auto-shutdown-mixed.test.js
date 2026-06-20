'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const SERVER = path.resolve(__dirname, '../services/http-server/index.js');

function get(baseUrl, p) {
  return new Promise(resolve => {
    const req = http.get(`${baseUrl}${p}`, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(null));
    req.setTimeout(800, () => { req.destroy(); resolve(null); });
  });
}

function openSse(baseUrl, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}/api/events?token=${token}`, res => {
      res.setEncoding('utf8');
      res.on('data', () => {});
      resolve({ req });
    });
    req.on('error', reject);
  });
}

async function waitDead(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = await get(baseUrl, '/healthz');
    if (code === null) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function waitAlive(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await get(baseUrl, '/healthz')) === 200) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

function pickPort() { return 33000 + Math.floor(Math.random() * 1000); }

const tmpFiles = [];
function cleanupTmpFiles() {
  for (const f of tmpFiles) { try { require('fs').unlinkSync(f); } catch (_) {} }
}

async function spawnServer(extraEnv) {
  const port = pickPort();
  const tokenFile = path.join(os.tmpdir(), `vl-token-${port}`);
  const pidFile = path.join(os.tmpdir(), `vl-pid-${port}`);
  tmpFiles.push(tokenFile, pidFile);
  const env = {
    ...process.env,
    PORT: String(port),
    AGENT_EVENTS_TOKEN: 'mixed-test-token',
    AUTO_SHUTDOWN: '1',
    AUTO_SHUTDOWN_EVICT_MS: '300',
    AUTO_SHUTDOWN_GRACE_MS: '300',
    AUTO_SHUTDOWN_INTERVAL_MS: '100',
    TOKEN_FILE: tokenFile,
    PID_FILE: pidFile,
    ...extraEnv,
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' });
  const baseUrl = `http://127.0.0.1:${port}`;
  if (!(await waitAlive(baseUrl, 4000))) {
    try { child.kill(); } catch (_) {}
    throw new Error('server did not become ready');
  }
  return { child, baseUrl, port, tokenFile, pidFile };
}

(async () => {
  const TOKEN = 'mixed-test-token';

  // Case A: no clients → shuts down within evict+grace window
  {
    const { child, baseUrl } = await spawnServer({});
    const dead = await waitDead(baseUrl, 3000);
    assert.ok(dead, 'expected shutdown with no clients');
    try { child.kill(); } catch (_) {}
    console.log('case A (no clients → shutdown): ok');
  }

  // Case B: SSE-only client keeps backend alive
  {
    const { child, baseUrl } = await spawnServer({});
    const sse = await openSse(baseUrl, TOKEN);
    // EVICT_MS(300) + GRACE_MS(300) + INTERVAL_MS(100) = 700ms worst-case; 1500ms gives ~2x margin for CI jitter
    await new Promise(r => setTimeout(r, 1500));
    const code = await get(baseUrl, '/healthz');
    assert.strictEqual(code, 200, 'SSE client should keep server alive');
    sse.req.destroy();
    const dead = await waitDead(baseUrl, 3000);
    assert.ok(dead, 'expected shutdown after SSE closes');
    try { child.kill(); } catch (_) {}
    console.log('case B (SSE keeps alive, then shutdown): ok');
  }

  // Case C: heartbeat client keeps backend alive (regression)
  {
    const { child, baseUrl } = await spawnServer({});
    const intervalId = setInterval(() => {
      const body = JSON.stringify({ clientId: 'c1' });
      const req = http.request({
        hostname: '127.0.0.1', port: new URL(baseUrl).port, path: '/api/heartbeat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                   'Authorization': `Bearer ${TOKEN}` }
      }, res => res.resume());
      req.on('error', () => {});
      req.write(body); req.end();
    }, 100);
    await new Promise(r => setTimeout(r, 1500));
    const code = await get(baseUrl, '/healthz');
    assert.strictEqual(code, 200, 'heartbeat client should keep alive');
    clearInterval(intervalId);
    const dead = await waitDead(baseUrl, 3000);
    assert.ok(dead, 'expected shutdown after heartbeat stops');
    try { child.kill(); } catch (_) {}
    console.log('case C (heartbeat keeps alive, then shutdown): ok');
  }

  cleanupTmpFiles();
  console.log('auto-shutdown-mixed: PASS');
})().catch(err => { cleanupTmpFiles(); console.error(err); process.exit(1); });
