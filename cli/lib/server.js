// cli/lib/server.js
'use strict';
const { connect } = require('../../core/agent-connect');
const { stop: stopHeartbeat } = require('../../core/heartbeat-client');

let _heartbeatHandle = null;

/**
 * Ensure the HTTP server is running. Returns the bearer token.
 * Starts a heartbeat so the server knows this process is alive.
 *
 * Options (for testing — same as agent-connect opts):
 *   healthzUrl  → baseUrl (derives baseUrl from healthzUrl for back-compat)
 *   tokenFile, serverEntry, extraEnv, noHeartbeat
 */
async function ensureServer(opts = {}) {
  // Back-compat: tests pass healthzUrl; derive baseUrl from it.
  const baseUrl = opts.healthzUrl
    ? opts.healthzUrl.replace('/healthz', '')
    : undefined;

  const { token, heartbeatHandle } = await connect({
    ...opts,
    ...(baseUrl ? { baseUrl } : {}),
  });
  _heartbeatHandle = heartbeatHandle;
  return token;
}

/**
 * Deregister heartbeat. Does NOT kill the server — the server manages
 * its own lifecycle via the heartbeat auto-shutdown mechanism.
 */
async function shutdown() {
  if (_heartbeatHandle) {
    await stopHeartbeat(_heartbeatHandle);
    _heartbeatHandle = null;
  }
}

function registerShutdown() {
  const handler = () => { shutdown(); };
  process.on('exit',   handler);
  process.on('SIGINT',  () => { shutdown().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)); });
}

module.exports = { ensureServer, shutdown, registerShutdown };
