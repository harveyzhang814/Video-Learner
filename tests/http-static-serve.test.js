'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { createApp } = require('../services/http-server');

(async () => {
  // Set up a fake web/dist with index.html
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-web-'));
  const distDir = path.join(tmp, 'web', 'dist');
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(distDir, 'index.html'),
    '<!doctype html><html><head><title>VDL</title></head><body><div id="root"></div></body></html>');
  fs.writeFileSync(path.join(distDir, 'assets', 'app.js'), 'console.log("ok");');

  const app = createApp({ rootDir: tmp, token: 'test-token-abc' });
  const server = http.createServer(app.callback()).listen(0);
  const port = server.address().port;

  // GET / returns HTML with injected token
  const homeRes = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(homeRes.status, 200);
  assert.match(homeRes.headers.get('content-type'), /text\/html/);
  const homeBody = await homeRes.text();
  assert.match(homeBody, /<meta name="vdl-token" content="test-token-abc">/);
  assert.match(homeBody, /<div id="root"><\/div>/);

  // Cache-Control: no-store on HTML
  assert.equal(homeRes.headers.get('cache-control'), 'no-store');

  // GET /assets/app.js returns asset
  const assetRes = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
  assert.equal(assetRes.status, 200);
  assert.match(await assetRes.text(), /console\.log/);

  // Missing dist returns 404, not crash
  fs.rmSync(distDir, { recursive: true, force: true });
  const missingRes = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(missingRes.status, 404);

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS http-static-serve');
})().catch((e) => { console.error(e); process.exit(1); });
