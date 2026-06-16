'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { createApp } = require('../services/http-server');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-reveal-'));

  // Stub task dir
  const taskId = 'abc123abc123';
  fs.mkdirSync(path.join(tmp, 'work', taskId), { recursive: true });

  const calls = [];
  const fakeSpawn = (cmd, args) => { calls.push({ cmd, args }); return { unref(){}, on(){} }; };

  const app = createApp({ rootDir: tmp, token: 'tk', spawn: fakeSpawn, host: '127.0.0.1' });
  const server = http.createServer(app.callback()).listen(0);
  const port = server.address().port;
  const auth = { Authorization: 'Bearer tk' };

  // Happy path
  const okRes = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/reveal`,
    { method: 'POST', headers: auth });
  assert.equal(okRes.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args[0].endsWith(path.join('work', taskId)));

  // Missing task
  const missRes = await fetch(`http://127.0.0.1:${port}/api/tasks/nope/reveal`,
    { method: 'POST', headers: auth });
  assert.equal(missRes.status, 404);

  // Non-loopback bind → 403
  server.close();
  const appLan = createApp({ rootDir: tmp, token: 'tk', spawn: fakeSpawn, host: '0.0.0.0' });
  const lanServer = http.createServer(appLan.callback()).listen(0);
  const lanPort = lanServer.address().port;
  const lanRes = await fetch(`http://127.0.0.1:${lanPort}/api/tasks/${taskId}/reveal`,
    { method: 'POST', headers: auth });
  assert.equal(lanRes.status, 403);
  lanServer.close();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS http-reveal');
})().catch((e) => { console.error(e); process.exit(1); });
