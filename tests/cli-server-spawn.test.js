// tests/cli-server-spawn.test.js
'use strict';
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const http   = require('http');

const PORT        = 3093;
const TOKEN_FILE  = '/tmp/vl-agent-token-spawn-test';
const PID_FILE    = '/tmp/vl-agent-spawn-test.pid';
const SERVER_ENTRY = path.resolve(__dirname, '../services/http-server/index.js');
const BASE_URL    = `http://127.0.0.1:${PORT}`;

delete require.cache[require.resolve('../cli/lib/server')];
const serverLib = require('../cli/lib/server');

function killByPid(pidFile) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) process.kill(pid, 'SIGTERM');
  } catch (_) {}
}

(async () => {
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE);   } catch {}

  // Test: ensureServer spawns a new server when none running
  const token = await serverLib.ensureServer({
    healthzUrl: `${BASE_URL}/healthz`,
    tokenFile: TOKEN_FILE,
    serverEntry: SERVER_ENTRY,
    noHeartbeat: true,
    extraEnv: { PORT: String(PORT), TOKEN_FILE, PID_FILE },
  });

  assert.ok(typeof token === 'string' && token.length > 0, 'should return a token');
  assert.ok(fs.existsSync(TOKEN_FILE), 'token file should exist after spawn');
  assert.ok(fs.existsSync(PID_FILE),   'PID file should exist after spawn');

  const fileToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  assert.strictEqual(fileToken, token, 'token file should match returned token');

  // shutdown() deregisters heartbeat but does NOT kill the server
  await serverLib.shutdown();
  await new Promise(r => setTimeout(r, 200));

  // Server should STILL be alive (heartbeat just stopped)
  const alive = await new Promise(resolve => {
    http.get(`${BASE_URL}/healthz`, res => resolve(res.statusCode === 200))
      .on('error', () => resolve(false));
  });
  assert.ok(alive, 'Server should still be running after shutdown() — heartbeat stop only');

  // Token file still exists (server manages it)
  assert.ok(fs.existsSync(TOKEN_FILE), 'token file should still exist after shutdown()');

  // Clean up: kill the spawned server via PID file
  killByPid(PID_FILE);
  await new Promise(r => setTimeout(r, 300));

  console.log('cli-server-spawn: PASS');
})().catch(err => { console.error(err); process.exit(1); });
