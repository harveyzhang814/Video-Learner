'use strict';
const assert = require('assert');
const http = require('http');

const PORT = 3099;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startMockServer() {
  const received = []; // clientIds that sent POST
  const deleted  = []; // clientIds that sent DELETE
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/heartbeat') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try { received.push(JSON.parse(body).clientId); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    } else if (req.method === 'DELETE' && req.url.startsWith('/api/heartbeat/')) {
      const clientId = decodeURIComponent(req.url.slice('/api/heartbeat/'.length));
      deleted.push(clientId);
      res.writeHead(200); res.end('{}');
    } else {
      res.writeHead(404); res.end();
    }
  });
  return new Promise(resolve => {
    server.listen(PORT, '127.0.0.1', () => resolve({ server, received, deleted }));
  });
}

(async () => {
  const { server, received, deleted } = await startMockServer();
  const heartbeat = require('../core/heartbeat-client');

  // Test 1: start() sends an immediate heartbeat
  const handle = heartbeat.start({ baseUrl: BASE_URL, token: 'tok', clientId: 'c1', intervalMs: 100 });
  await new Promise(r => setTimeout(r, 60));
  assert.ok(received.includes('c1'), `expected immediate heartbeat, got: ${JSON.stringify(received)}`);

  // Test 2: interval sends additional heartbeats
  await new Promise(r => setTimeout(r, 350));
  const count = received.filter(x => x === 'c1').length;
  assert.ok(count >= 3, `expected >=3 heartbeats after 350ms at 100ms interval, got ${count}`);

  // Test 3: stop() sends DELETE and clears interval
  await heartbeat.stop(handle);
  assert.ok(deleted.includes('c1'), `expected DELETE for c1, got: ${JSON.stringify(deleted)}`);
  const countAfter = received.filter(x => x === 'c1').length;
  await new Promise(r => setTimeout(r, 200)); // wait to confirm no more heartbeats
  const countFinal = received.filter(x => x === 'c1').length;
  assert.strictEqual(countAfter, countFinal, 'no heartbeats should be sent after stop()');

  // Test 4: stop(null) does not throw
  await heartbeat.stop(null);

  // Test 5: network error is swallowed (no unhandled rejection)
  const badHandle = heartbeat.start({ baseUrl: 'http://127.0.0.1:1', token: 'x', clientId: 'c2', intervalMs: 50 });
  await new Promise(r => setTimeout(r, 60));
  await heartbeat.stop(badHandle); // must not throw

  server.close();
  console.log('heartbeat-client: PASS');
})().catch(err => { console.error(err); process.exit(1); });
