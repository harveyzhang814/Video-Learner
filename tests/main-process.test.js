const assert = require('assert');
const http = require('http');
const net = require('net');

const {
  sanitizeLogLine,
  getFreePort,
  startLocalHttpService,
  stopLocalHttpService,
  getHttpServiceInfo,
} = require('../electron/src/main-helpers');

async function run() {
  // ----- M4: sanitizeLogLine -----
  assert.strictEqual(sanitizeLogLine(''), '');
  assert.strictEqual(
    sanitizeLogLine('GET /api/events?token=abc123&foo=bar'),
    'GET /api/events?token=[REDACTED]&foo=bar'
  );
  assert.strictEqual(
    sanitizeLogLine('something ?token=secret123'),
    'something ?token=[REDACTED]'
  );
  assert.ok(!sanitizeLogLine('log with ?token=xyz').includes('xyz'));
  console.log('M4 sanitizeLogLine: ok');

  // ----- M2: getFreePort -----
  const port = await getFreePort();
  assert.strictEqual(typeof port, 'number');
  assert.ok(port > 0);
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  server.close();
  console.log('M2 getFreePort: ok');

  // ----- M1/M3/M5: startLocalHttpService + healthz + getHttpServiceInfo -----
  const info = await startLocalHttpService();
  assert.ok(info);
  assert.strictEqual(typeof info.baseUrl, 'string');
  assert.ok(info.baseUrl.startsWith('http://127.0.0.1:'));
  assert.strictEqual(typeof info.token, 'string');
  assert.ok(info.token.length > 0);

  const healthRes = await new Promise((resolve, reject) => {
    http.get(`${info.baseUrl}/healthz`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          resolve({ status: res.statusCode, body });
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.body?.ok, true);

  const getInfo = getHttpServiceInfo();
  assert.deepStrictEqual(getInfo, info);
  console.log('M1/M3/M5: ok');

  // ----- M6: stopLocalHttpService -----
  stopLocalHttpService();
  await new Promise((r) => setTimeout(r, 500));

  const portNum = parseInt(info.baseUrl.replace('http://127.0.0.1:', ''), 10);
  const cannotConnect = await new Promise((resolve) => {
    const socket = net.connect(portNum, '127.0.0.1', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => resolve(true));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(true);
    });
  });
  assert.strictEqual(cannotConnect, true, 'port should be released after stop');
  assert.strictEqual(getHttpServiceInfo(), null);
  console.log('M6 stopLocalHttpService: ok');

  console.log('main-process.test.js: all passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
