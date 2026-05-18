'use strict';
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TOKEN_FILE = '/tmp/vl-agent-token';
const DEFAULT_HEALTHZ = 'http://127.0.0.1:3000/healthz';
const SERVER_ENTRY = path.resolve(__dirname, '../../services/http-server/index.js');

let _managedChild = null;

function _checkHealthz(url, timeoutMs = 1000) {
  return new Promise(resolve => {
    const req = http.get(url, res => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

/**
 * Ensure HTTP server is running. Returns the bearer token.
 * Options (for testing):
 *   healthzUrl  — override healthz URL (default: http://127.0.0.1:3000/healthz)
 *   tokenFile   — override token file path (default: /tmp/vl-agent-token)
 *   serverEntry — override server script path
 */
async function ensureServer(opts = {}) {
  const healthzUrl = opts.healthzUrl || DEFAULT_HEALTHZ;
  const tokenFile = opts.tokenFile || DEFAULT_TOKEN_FILE;
  const entry = opts.serverEntry || SERVER_ENTRY;

  const alive = await _checkHealthz(healthzUrl);
  if (alive) {
    let token;
    try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch {}
    if (!token) {
      throw new Error(
        `Server is running but token file not found at ${tokenFile}. Restart the server.`
      );
    }
    return token;
  }

  // Spawn our own server
  const token = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, AGENT_EVENTS_TOKEN: token },
    stdio: 'ignore',
    detached: false,
  });
  _managedChild = child;

  // Wait up to 5s for healthz
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    if (await _checkHealthz(healthzUrl)) return token;
  }
  child.kill();
  _managedChild = null;
  throw new Error('HTTP server failed to start within 5s');
}

function didSpawn() {
  return _managedChild !== null;
}

function shutdown(tokenFile) {
  const file = tokenFile || DEFAULT_TOKEN_FILE;
  if (_managedChild) {
    _managedChild.kill();
    _managedChild = null;
    try { fs.unlinkSync(file); } catch {}
  }
}

function registerShutdown(tokenFile) {
  const handler = () => { shutdown(tokenFile); };
  process.on('exit', handler);
  process.on('SIGINT', () => { handler(); process.exit(0); });
  process.on('SIGTERM', () => { handler(); process.exit(0); });
}

module.exports = { ensureServer, shutdown, registerShutdown, didSpawn };
