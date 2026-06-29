// core/agent-connect.js
'use strict';
const http    = require('http');
const { spawn, execSync } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const heartbeat = require('./heartbeat-client');

const DEFAULT_TOKEN_FILE = '/tmp/vl-agent-token';
const DEFAULT_BASE_URL   = 'http://127.0.0.1:3000';
const SERVER_ENTRY       = path.resolve(__dirname, '../services/http-server/index.js');
const STARTUP_TIMEOUT_MS = 8000;

function _checkHealthz(baseUrl, timeoutMs = 1500) {
  return new Promise(resolve => {
    const req = http.get(`${baseUrl}/healthz`, res => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

function _readToken(tokenFile) {
  try {
    const t = fs.readFileSync(tokenFile, 'utf8').trim();
    return t || null;
  } catch (_) {
    return null;
  }
}

/** Retry reading the token file up to 3 times with 100 ms gaps.
 *  Guards against the narrow race where healthz responds before the token file is flushed. */
async function _readTokenWithRetry(tokenFile) {
  for (let i = 0; i < 3; i++) {
    const t = _readToken(tokenFile);
    if (t) return t;
    if (i < 2) await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

/** Kill the stale process listening on baseUrl's port and wait for it to exit. */
async function _killStaleServer(baseUrl) {
  const port = new URL(baseUrl).port || '3000';
  try {
    const pids = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
    for (const pid of pids) process.kill(Number(pid), 'SIGTERM');
  } catch (_) {}
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await _checkHealthz(baseUrl))) return;
    await new Promise(r => setTimeout(r, 200));
  }
}

async function _waitForReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await _checkHealthz(baseUrl)) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/**
 * Connect to (or start) the agent HTTP server on port 3000.
 *
 * Returns { baseUrl, token, heartbeatHandle }.
 * heartbeatHandle is null when opts.noHeartbeat is true.
 *
 * Options (all optional — override defaults for testing):
 *   baseUrl           — default: http://127.0.0.1:3000
 *   tokenFile         — default: /tmp/vl-agent-token
 *   serverEntry       — default: services/http-server/index.js
 *   clientId          — heartbeat client ID (default: auto-generated)
 *   heartbeatIntervalMs — default: 10000
 *   noHeartbeat       — skip heartbeat registration (for short-lived queries)
 *   extraEnv          — extra env vars to pass when spawning (for testing)
 */
async function connect(opts = {}) {
  const baseUrl   = opts.baseUrl     || DEFAULT_BASE_URL;
  const tokenFile = opts.tokenFile   || DEFAULT_TOKEN_FILE;
  const entry     = opts.serverEntry || SERVER_ENTRY;
  const clientId  = opts.clientId    || `vl-${process.pid}-${Date.now()}`;

  function _startHeartbeat(token) {
    if (opts.noHeartbeat) return null;
    return heartbeat.start({
      baseUrl, token, clientId,
      intervalMs: opts.heartbeatIntervalMs || 10000,
    });
  }

  // ── Phase 1: server already alive ────────────────────────────────────────
  if (await _checkHealthz(baseUrl)) {
    const token = await _readTokenWithRetry(tokenFile);
    if (token) {
      return { baseUrl, token, heartbeatHandle: _startHeartbeat(token) };
    }
    // Token file missing — stale server (e.g. leftover from a crashed session).
    // Kill it and fall through to Phase 2 to spawn a fresh one.
    await _killStaleServer(baseUrl);
  }

  // ── Phase 2: spawn a new server ──────────────────────────────────────────
  const spawnEnv = {
    ...process.env,
    AUTO_SHUTDOWN: '1',
    ...(opts.extraEnv || {}),
  };
  // Ensure server starts on the expected port (default 3000)
  if (!spawnEnv.PORT) spawnEnv.PORT = String(new URL(baseUrl).port || '3000');

  // In Electron, process.execPath is the Electron binary — use 'node' instead.
  const nodeExecutable = process.versions.electron ? 'node' : process.execPath;
  const child = spawn(nodeExecutable, [entry], {
    env: spawnEnv,
    stdio: 'ignore',
    detached: false,
  });

  const ready = await _waitForReady(baseUrl, STARTUP_TIMEOUT_MS);

  if (!ready) {
    // Possible EADDRINUSE: another process won the race. Try healthz once more.
    if (await _checkHealthz(baseUrl)) {
      try { child.kill(); } catch (_) {}
      const token = await _readTokenWithRetry(tokenFile);
      if (!token) {
        try { child.kill(); } catch (_) {}
        await _killStaleServer(baseUrl);
        return connect(opts); // stale server cleared — retry once
      }
      return { baseUrl, token, heartbeatHandle: _startHeartbeat(token) };
    }
    try { child.kill(); } catch (_) {}
    throw new Error(`Agent HTTP server failed to start within ${STARTUP_TIMEOUT_MS} ms`);
  }

  const token = await _readTokenWithRetry(tokenFile);
  if (!token) {
    try { child.kill(); } catch (_) {}
    throw new Error(`Server started but token file not found at ${tokenFile}`);
  }
  return { baseUrl, token, heartbeatHandle: _startHeartbeat(token) };
}

module.exports = { connect };
