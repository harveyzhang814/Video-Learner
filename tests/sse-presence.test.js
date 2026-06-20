'use strict';
const assert = require('assert');
const http = require('http');
const { createApp } = require('../services/http-server');

const TOKEN = 'sse-presence-test-token';

function openSse(baseUrl) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}/api/events?token=${TOKEN}`, (res) => {
      res.setEncoding('utf8');
      res.on('data', () => {}); // drain
      resolve({ req, res });
    });
    req.on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const app = createApp({ token: TOKEN });
  const server = http.createServer(app.callback());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // sseRegistry must be exposed on app.context
  assert.ok(app.context.sseRegistry instanceof Set, 'app.context.sseRegistry must be a Set');
  assert.strictEqual(app.context.sseRegistry.size, 0, 'starts empty');

  // Open 1st connection
  const c1 = await openSse(baseUrl);
  await sleep(150);
  assert.strictEqual(app.context.sseRegistry.size, 1, 'one connection registered');

  // Open 2nd connection
  const c2 = await openSse(baseUrl);
  await sleep(150);
  assert.strictEqual(app.context.sseRegistry.size, 2, 'two connections registered');

  // Close 1st
  c1.req.destroy();
  await sleep(200);
  assert.strictEqual(app.context.sseRegistry.size, 1, 'one connection after first close');

  // Close 2nd
  c2.req.destroy();
  await sleep(200);
  assert.strictEqual(app.context.sseRegistry.size, 0, 'empty after both close');

  server.close();
  console.log('sse-presence: PASS');
})().catch(err => { console.error(err); process.exit(1); });
