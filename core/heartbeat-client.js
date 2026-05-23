'use strict';
const http = require('http');

function _post(baseUrl, token, clientId) {
  return new Promise(resolve => {
    try {
      const body = JSON.stringify({ clientId });
      const url = new URL('/api/heartbeat', baseUrl);
      const req = http.request(
        { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`,
                     'Content-Length': Buffer.byteLength(body) } },
        res => { res.resume(); resolve(); }
      );
      req.on('error', () => resolve());
      req.setTimeout(2000, () => { req.destroy(); resolve(); });
      req.write(body);
      req.end();
    } catch (_) { resolve(); }
  });
}

function _delete(baseUrl, token, clientId) {
  return new Promise(resolve => {
    try {
      const url = new URL(`/api/heartbeat/${encodeURIComponent(clientId)}`, baseUrl);
      const req = http.request(
        { hostname: url.hostname, port: url.port, path: url.pathname, method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` } },
        res => { res.resume(); resolve(); }
      );
      req.on('error', () => resolve());
      req.setTimeout(2000, () => { req.destroy(); resolve(); });
      req.end();
    } catch (_) { resolve(); }
  });
}

/**
 * Start sending heartbeats. Returns a handle to pass to stop().
 */
function start({ baseUrl, token, clientId, intervalMs = 10000 }) {
  _post(baseUrl, token, clientId); // immediate
  const intervalId = setInterval(() => _post(baseUrl, token, clientId), intervalMs);
  intervalId.unref(); // don't prevent process exit if this is the only thing running
  return { intervalId, baseUrl, token, clientId };
}

/**
 * Stop heartbeats and send deregister DELETE. Safe to call with null.
 */
async function stop(handle) {
  if (!handle) return;
  clearInterval(handle.intervalId);
  handle.intervalId = null; // prevent double-stop
  await _delete(handle.baseUrl, handle.token, handle.clientId);
}

module.exports = { start, stop };
