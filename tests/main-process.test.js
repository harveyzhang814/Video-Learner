const assert = require('assert');
const http = require('http');

const {
  sanitizeLogLine,
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

  // ----- M1/M3/M5: startLocalHttpService + healthz + getHttpServiceInfo -----
  const info = await startLocalHttpService();
  assert.ok(info);
  assert.strictEqual(typeof info.baseUrl, 'string');
  assert.ok(info.baseUrl.startsWith('http://'));
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
  // In the new architecture, stop() deregisters the heartbeat and clears cached
  // service info. The server itself manages its own lifecycle (auto-shutdown).
  await stopLocalHttpService();
  await new Promise((r) => setTimeout(r, 200));

  // After stop, getHttpServiceInfo() must return null
  assert.strictEqual(getHttpServiceInfo(), null);
  console.log('M6 stopLocalHttpService: ok');

  console.log('main-process.test.js: all passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
