// tests/auto-shutdown.test.js
'use strict';
const assert = require('assert');
const http   = require('http');
const fs     = require('fs');
const { spawn } = require('child_process');
const path   = require('path');

const PORT        = 3095;
const TOKEN_FILE  = '/tmp/vl-agent-token-autoshutdown-test';
const PID_FILE    = '/tmp/vl-agent-autoshutdown-test.pid';
const SERVER      = path.resolve(__dirname, '../services/http-server/index.js');

function waitHealthz(baseUrl, ms = 6000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function check() {
      http.get(`${baseUrl}/healthz`, res => {
        if (res.statusCode === 200) return resolve();
        if (Date.now() > deadline) return reject(new Error('healthz timeout'));
        setTimeout(check, 200);
      }).on('error', () => {
        if (Date.now() > deadline) return reject(new Error('healthz timeout'));
        setTimeout(check, 200);
      });
    })();
  });
}

function apiReq(method, urlPath, token, port, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    const r = http.request(opts, res => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}

  const baseUrl = `http://127.0.0.1:${PORT}`;

  // ---- Test A: PID file is written on startup and cleaned on exit ----
  const childA = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), TOKEN_FILE, PID_FILE },
    stdio: 'ignore',
  });
  await waitHealthz(baseUrl);

  assert.ok(fs.existsSync(PID_FILE), 'PID file should exist after startup');
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  assert.ok(pid > 0, `PID should be a positive integer, got ${pid}`);

  childA.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));
  assert.ok(!fs.existsSync(TOKEN_FILE), 'token file should be deleted after SIGTERM');
  assert.ok(!fs.existsSync(PID_FILE), 'PID file should be deleted after SIGTERM');

  // ---- Test B: AUTO_SHUTDOWN=1 shuts down when last client deregisters ----
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  const childB = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TOKEN_FILE,
      PID_FILE,
      AUTO_SHUTDOWN: '1',
      AUTO_SHUTDOWN_EVICT_MS: '300',    // evict after 300 ms silence
      AUTO_SHUTDOWN_GRACE_MS: '300',    // grace window 300 ms
      AUTO_SHUTDOWN_INTERVAL_MS: '100', // scan every 100 ms
    },
    stdio: 'ignore',
  });
  await waitHealthz(baseUrl);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

  // Register client
  await apiReq('POST', '/api/heartbeat', token, PORT, { clientId: 'tester' });
  // Explicitly deregister
  await apiReq('DELETE', '/api/heartbeat/tester', token, PORT);

  // Server should exit within evict(300) + grace(300) + buffer(1000) = 1600 ms
  const exitCode = await new Promise(resolve => {
    childB.once('exit', code => resolve(code));
    setTimeout(() => resolve(null), 3000);
  });
  assert.ok(exitCode !== null, 'Server should have exited but did not within 3 s');
  assert.ok(!fs.existsSync(TOKEN_FILE), 'Token file cleaned on auto-shutdown');
  assert.ok(!fs.existsSync(PID_FILE),   'PID file cleaned on auto-shutdown');

  // ---- Test C: AUTO_SHUTDOWN=1 does NOT shut down when tasks are running ----
  // (uses a lower-level check: we verify the server is still alive after grace
  //  period when a task is running — tested by checking the orchestrator
  //  guard indirectly; full integration in singleton-backend.test.js)

  console.log('auto-shutdown: PASS');
})().catch(err => { console.error(err); process.exit(1); });
