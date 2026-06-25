// electron/src/main-helpers.js
'use strict';
const { connect } = require('../../core/agent-connect');
const { stop: stopHeartbeat } = require('../../core/heartbeat-client');

function sanitizeLogLine(line) {
  if (!line) return '';
  return String(line).replace(/\?token=[^&\s]+/g, '?token=[REDACTED]');
}

let _serviceInfo = null; // { baseUrl, token, heartbeatHandle }

/**
 * Ensure the HTTP service is running (port 3000).
 * Reuses an already-running instance if one is alive.
 * Returns { baseUrl, token }.
 */
async function startLocalHttpService() {
  if (_serviceInfo) return { baseUrl: _serviceInfo.baseUrl, token: _serviceInfo.token };

  try {
    _serviceInfo = await connect({
      clientId: `electron-${process.pid}`,
      heartbeatIntervalMs: 10000,
    });
    console.log('[agent-http] ready', { baseUrl: _serviceInfo.baseUrl });
    return { baseUrl: _serviceInfo.baseUrl, token: _serviceInfo.token };
  } catch (err) {
    console.error('[agent-http] failed to start', err && err.message ? err.message : err);
    throw err;
  }
}

/**
 * Deregister heartbeat so the server can count down toward auto-shutdown.
 * Does NOT SIGTERM the server — the server manages its own lifecycle.
 */
async function stopLocalHttpService() {
  if (!_serviceInfo) return;
  try {
    await stopHeartbeat(_serviceInfo.heartbeatHandle);
  } catch (_) {}
  _serviceInfo = null;
}

/**
 * Returns cached service info, or null if not started yet.
 */
function getHttpServiceInfo() {
  return _serviceInfo ? { baseUrl: _serviceInfo.baseUrl, token: _serviceInfo.token } : null;
}

module.exports = { sanitizeLogLine, startLocalHttpService, stopLocalHttpService, getHttpServiceInfo };
