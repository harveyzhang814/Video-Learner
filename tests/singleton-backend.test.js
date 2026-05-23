// tests/singleton-backend.test.js
// Integration tests for singleton backend behaviour.
// Spawns and kills real server processes.
'use strict';
const assert  = require('assert');
const fs      = require('fs');
const http    = require('http');
const path    = require('path');
const { spawn } = require('child_process');

const SERVER   = path.resolve(__dirname, '../services/http-server/index.js');
const PORT     = 3092;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Per-test token/PID files to avoid cross-test pollution
function tmpFiles(suffix) {
  return {
    tokenFile: `/tmp/vl-singleton-token-${suffix}`,
    pidFile:   `/tmp/vl-singleton-pid-${suffix}`,
  };
}

function cleanup(files) {
  try { fs.unlinkSync(files.tokenFile); } catch (_) {}
  try { fs.unlinkSync(files.pidFile);   } catch (_) {}
}

function waitHealthz(ms = 6000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function check() {
      http.get(`${BASE_URL}/healthz`, res => {
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

function waitDead(ms = 4000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function check() {
      http.get(`${BASE_URL}/healthz`, res => {
        res.resume();
        if (Date.now() > deadline) return reject(new Error('server still alive'));
        setTimeout(check, 200);
      }).on('error', () => resolve()); // connection refused = dead
    })();
  });
}

function killByPid(pidFile) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) process.kill(pid, 'SIGTERM');
  } catch (_) {}
}

function spawnServer(files, extra = {}) {
  return spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TOKEN_FILE: files.tokenFile,
      PID_FILE:   files.pidFile,
      ...extra,
    },
    stdio: 'ignore',
  });
}

// Fresh connect() each test
function freshConnect(opts = {}) {
  delete require.cache[require.resolve('../core/agent-connect')];
  delete require.cache[require.resolve('../core/heartbeat-client')];
  return require('../core/agent-connect').connect({
    baseUrl: BASE_URL,
    noHeartbeat: true,
    ...opts,
  });
}

(async () => {
  // ── Scenario 1: CLI connects to existing server, no extra spawn ──────────
  {
    const f = tmpFiles('s1'); cleanup(f);
    const child = spawnServer(f);
    await waitHealthz();
    const existingToken = fs.readFileSync(f.tokenFile, 'utf8').trim();

    const r = await freshConnect({ tokenFile: f.tokenFile, serverEntry: SERVER });
    assert.strictEqual(r.token, existingToken, 'S1: should reuse existing server token');

    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S1 PASS: CLI reuses existing server');
  }

  // ── Scenario 2: agent:serve + CLI reuse (most common production path) ────
  {
    const f = tmpFiles('s2'); cleanup(f);
    // Simulate "npm run agent:serve" — no AUTO_SHUTDOWN
    const child = spawnServer(f);
    await waitHealthz();
    const agentToken = fs.readFileSync(f.tokenFile, 'utf8').trim();

    // CLI connects
    const r = await freshConnect({ tokenFile: f.tokenFile, serverEntry: SERVER });
    assert.strictEqual(r.token, agentToken, 'S2: CLI should get same token as agent:serve');

    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S2 PASS: agent:serve + CLI reuse');
  }

  // ── Scenario 3: server dead → connect() spawns new one ───────────────────
  {
    const f = tmpFiles('s3'); cleanup(f);

    const r = await freshConnect({
      tokenFile: f.tokenFile, serverEntry: SERVER,
      extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
    });
    assert.ok(r.token.length > 0, 'S3: should have a token');
    assert.ok(fs.existsSync(f.tokenFile), 'S3: token file should exist');

    killByPid(f.pidFile);
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S3 PASS: server spawned when dead');
  }

  // ── Scenario 4: stale token file recovery ─────────────────────────────────
  {
    const f = tmpFiles('s4'); cleanup(f);
    // Write a stale token file (server not running)
    fs.writeFileSync(f.tokenFile, 'stale-token-value');

    const r = await freshConnect({
      tokenFile: f.tokenFile, serverEntry: SERVER,
      extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
    });
    // healthz was dead → new server spawned → new token written
    assert.notStrictEqual(r.token, 'stale-token-value', 'S4: should overwrite stale token');
    assert.ok(r.token.length > 0, 'S4: new token should be non-empty');

    killByPid(f.pidFile);
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S4 PASS: stale token file overwritten on respawn');
  }

  // ── Scenario 5: last client exits → server auto-shuts down ───────────────
  {
    const f = tmpFiles('s5'); cleanup(f);
    spawnServer(f, {
      AUTO_SHUTDOWN: '1',
      AUTO_SHUTDOWN_EVICT_MS: '300',
      AUTO_SHUTDOWN_GRACE_MS: '300',
      AUTO_SHUTDOWN_INTERVAL_MS: '100',
    });
    await waitHealthz();
    const token = fs.readFileSync(f.tokenFile, 'utf8').trim();

    // Register and immediately deregister
    const hb = require('../core/heartbeat-client');
    const handle = hb.start({ baseUrl: BASE_URL, token, clientId: 'last-client', intervalMs: 5000 });
    await new Promise(r => setTimeout(r, 50));
    await hb.stop(handle);

    // Server should exit within evict+grace+buffer = ~2 s
    await waitDead(4000);
    assert.ok(!fs.existsSync(f.tokenFile), 'S5: token file cleaned on auto-shutdown');
    cleanup(f);
    console.log('S5 PASS: server auto-shuts down after last client exits');
  }

  // ── Scenario 6: two clients, first exits, server stays up ────────────────
  {
    const f = tmpFiles('s6'); cleanup(f);
    spawnServer(f, {
      AUTO_SHUTDOWN: '1',
      AUTO_SHUTDOWN_EVICT_MS: '300',
      AUTO_SHUTDOWN_GRACE_MS: '300',
      AUTO_SHUTDOWN_INTERVAL_MS: '100',
    });
    await waitHealthz();
    const token = fs.readFileSync(f.tokenFile, 'utf8').trim();

    const hb = require('../core/heartbeat-client');
    const h1 = hb.start({ baseUrl: BASE_URL, token, clientId: 'client-1', intervalMs: 200 });
    const h2 = hb.start({ baseUrl: BASE_URL, token, clientId: 'client-2', intervalMs: 200 });

    // First client leaves
    await hb.stop(h1);
    await new Promise(r => setTimeout(r, 1200)); // wait > grace period

    // Server should still be alive (client-2 still sending heartbeats)
    const alive = await new Promise(resolve => {
      http.get(`${BASE_URL}/healthz`, res => resolve(res.statusCode === 200))
        .on('error', () => resolve(false));
    });
    assert.ok(alive, 'S6: server should still be alive while client-2 is connected');

    // Now stop client-2 → server shuts down
    await hb.stop(h2);
    await waitDead(4000);
    cleanup(f);
    console.log('S6 PASS: server stays alive until last client exits');
  }

  // ── Scenario 7: race condition — two simultaneous connect() calls ─────────
  {
    const f = tmpFiles('s7'); cleanup(f);

    // Both callers find dead server and try to spawn simultaneously
    const [r1, r2] = await Promise.all([
      freshConnect({
        tokenFile: f.tokenFile, serverEntry: SERVER,
        extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
      }),
      freshConnect({
        tokenFile: f.tokenFile, serverEntry: SERVER,
        extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
      }),
    ]);

    // Both should succeed (one spawned, one hit EADDRINUSE and retried healthz)
    assert.ok(r1.token.length > 0, 'S7: r1 should have token');
    assert.ok(r2.token.length > 0, 'S7: r2 should have token');
    // Both should get the same token (from the single running server)
    assert.strictEqual(r1.token, r2.token, 'S7: both callers should get the same token');

    killByPid(f.pidFile);
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S7 PASS: race condition — both callers get same token');
  }

  // ── Scenario 8: server crash recovery — next connect() respawns ───────────
  {
    const f = tmpFiles('s8'); cleanup(f);
    const child = spawnServer(f);
    await waitHealthz();

    // Kill the server unexpectedly (simulate crash)
    child.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 300));

    // Next connect() should detect dead healthz and spawn a new server
    const r = await freshConnect({
      tokenFile: f.tokenFile, serverEntry: SERVER,
      extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
    });
    assert.ok(r.token.length > 0, 'S8: should recover with new token after crash');

    killByPid(f.pidFile);
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S8 PASS: server crash recovery');
  }

  console.log('\nsingleton-backend: ALL 8 SCENARIOS PASS');
})().catch(err => { console.error(err); process.exit(1); });
