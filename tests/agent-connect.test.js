// tests/agent-connect.test.js
'use strict';
const assert = require('assert');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const PORT       = 3094;
const BASE_URL   = `http://127.0.0.1:${PORT}`;
const TOKEN_FILE = '/tmp/vl-agent-token-connect-test';
const PID_FILE   = '/tmp/vl-agent-connect-test.pid';
const SERVER     = path.resolve(__dirname, '../services/http-server/index.js');

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

function killByPid(pidFile) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) process.kill(pid, 'SIGTERM');
  } catch (_) {}
}

// Fresh require to avoid module cache issues across tests
function freshConnect() {
  delete require.cache[require.resolve('../core/agent-connect')];
  return require('../core/agent-connect').connect;
}

(async () => {
  const connect = freshConnect();

  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE);   } catch {}

  // ---- Test 1: connect() when server is already running ----
  const child = require('child_process').spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), TOKEN_FILE, PID_FILE },
    stdio: 'ignore',
  });
  await waitHealthz(BASE_URL);
  const existingToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

  const r1 = await connect({
    baseUrl: BASE_URL, tokenFile: TOKEN_FILE,
    serverEntry: SERVER, noHeartbeat: true,
  });
  assert.strictEqual(r1.token, existingToken, 'should return existing server token');
  assert.strictEqual(r1.baseUrl, BASE_URL);
  assert.strictEqual(r1.heartbeatHandle, null);

  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 400));

  // ---- Test 2: connect() when server is dead — spawns new one ----
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE);   } catch {}

  const r2 = await connect({
    baseUrl: BASE_URL, tokenFile: TOKEN_FILE,
    serverEntry: SERVER, noHeartbeat: true,
    extraEnv: { PORT: String(PORT), TOKEN_FILE, PID_FILE },
  });
  assert.ok(typeof r2.token === 'string' && r2.token.length > 0, 'should return new token');
  assert.strictEqual(r2.heartbeatHandle, null);

  // Clean up spawned server
  killByPid(PID_FILE);
  await new Promise(r => setTimeout(r, 400));

  // ---- Test 3: connect() starts heartbeat when noHeartbeat is not set ----
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE);   } catch {}

  const r3 = await connect({
    baseUrl: BASE_URL, tokenFile: TOKEN_FILE,
    serverEntry: SERVER,
    extraEnv: { PORT: String(PORT), TOKEN_FILE, PID_FILE },
  });
  assert.ok(r3.heartbeatHandle !== null, 'should return a heartbeat handle');

  // Stop heartbeat and kill server
  const { stop } = require('../core/heartbeat-client');
  await stop(r3.heartbeatHandle);
  killByPid(PID_FILE);
  await new Promise(r => setTimeout(r, 400));

  console.log('agent-connect: PASS');
})().catch(err => { console.error(err); process.exit(1); });
