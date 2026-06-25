'use strict';
const assert = require('assert');
const http = require('http');
const { createApp } = require('../services/http-server');

const TOKEN = 'hb-endpoint-test-token';
const PORT  = 3097;

function req(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { 'Authorization': `Bearer ${token || TOKEN}`, 'Content-Type': 'application/json' },
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let srv;
(async () => {
  const app = createApp({ token: TOKEN });
  srv = http.createServer(app.callback()).listen(PORT, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));

  // Test 1: POST /api/heartbeat → 200
  const r1 = await req('POST', '/api/heartbeat', { clientId: 'c1' });
  assert.strictEqual(r1.status, 200, `expected 200, got ${r1.status}: ${JSON.stringify(r1.body)}`);

  // Test 2: POST /api/heartbeat with bad token → 401
  const r2 = await req('POST', '/api/heartbeat', { clientId: 'c1' }, 'bad');
  assert.strictEqual(r2.status, 401);

  // Test 3: DELETE /api/heartbeat/:clientId → 200
  const r3 = await req('DELETE', '/api/heartbeat/c1');
  assert.strictEqual(r3.status, 200);

  // Test 4: DELETE /api/heartbeat/nonexistent → 200 (idempotent)
  const r4 = await req('DELETE', '/api/heartbeat/nonexistent');
  assert.strictEqual(r4.status, 200);

  // Test 5: GET /api/heartbeat/status → returns clientCount
  const r5 = await req('GET', '/api/heartbeat/status');
  assert.strictEqual(r5.status, 200);
  assert.ok(typeof r5.body.clientCount === 'number', `expected clientCount number, got ${JSON.stringify(r5.body)}`);

  srv.close();
  console.log('heartbeat-endpoints: PASS');
})().catch(err => { if (srv) srv.close(); console.error(err); process.exit(1); });
