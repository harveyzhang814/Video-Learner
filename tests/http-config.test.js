'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../services/http-server');

const TOKEN = 'test-config-token';

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-config-http-'));
  fs.mkdirSync(path.join(tmp, 'scripts'), { recursive: true });

  const app = createApp({ rootDir: tmp, token: TOKEN, runTaskForDownstream: async () => {} });
  const server = http.createServer(app.callback());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

  let failures = 0;
  function check(name, fn) {
    return fn().then(() => console.log(`  ✓ ${name}`)).catch(e => {
      failures++;
      console.error(`  ✗ ${name}: ${e.message}`);
    });
  }

  async function req(method, p, body) {
    const res = await fetch(base + p, {
      method,
      headers: hdrs,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  }

  // GET /api/config — default (no settings.conf)
  await check('GET /api/config returns null workRoot when default', async () => {
    const { status, body } = await req('GET', '/api/config');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.workRoot, null);
    assert.ok(body.workDir.endsWith('/work'), `workDir should end with /work: ${body.workDir}`);
    assert.ok(typeof body.settingsPath === 'string');
  });

  // POST /api/config — valid absolute path
  await check('POST /api/config writes settings.conf', async () => {
    const { status, body } = await req('POST', '/api/config', { workRoot: '/tmp/vl-new-root' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.workRoot, '/tmp/vl-new-root');
    assert.strictEqual(body.restart_required, true);
    const conf = fs.readFileSync(path.join(tmp, 'scripts', 'settings.conf'), 'utf8');
    assert.ok(conf.includes('WORK_ROOT=/tmp/vl-new-root'), `settings.conf should contain new value: ${conf}`);
  });

  // POST /api/config — tilde path accepted
  await check('POST /api/config accepts ~ path', async () => {
    const { status, body } = await req('POST', '/api/config', { workRoot: '~/Syncthing/vl' });
    assert.strictEqual(status, 200);
    assert.strictEqual(body.ok, true);
    const conf = fs.readFileSync(path.join(tmp, 'scripts', 'settings.conf'), 'utf8');
    assert.ok(conf.includes('WORK_ROOT=~/Syncthing/vl'));
  });

  // POST /api/config — relative path rejected
  await check('POST /api/config rejects relative path', async () => {
    const { status, body } = await req('POST', '/api/config', { workRoot: 'relative/path' });
    assert.strictEqual(status, 400);
    assert.ok(typeof body.error === 'string');
  });

  // POST /api/config — empty body rejected
  await check('POST /api/config rejects missing workRoot', async () => {
    const { status, body } = await req('POST', '/api/config', {});
    assert.strictEqual(status, 400);
    assert.ok(typeof body.error === 'string');
  });

  // GET /api/config reflects written value (reads settings.conf)
  await check('GET /api/config reflects persisted value', async () => {
    fs.writeFileSync(path.join(tmp, 'scripts', 'settings.conf'), 'WORK_ROOT=/tmp/persisted\n', 'utf8');
    const saved = process.env.WORK_ROOT;
    delete process.env.WORK_ROOT;
    try {
      const { status, body } = await req('GET', '/api/config');
      assert.strictEqual(status, 200);
      assert.strictEqual(body.workRoot, '/tmp/persisted');
      assert.ok(body.workDir.endsWith('/work'));
    } finally {
      if (saved === undefined) delete process.env.WORK_ROOT; else process.env.WORK_ROOT = saved;
    }
  });

  await new Promise(r => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });

  if (failures > 0) { console.error(`http-config.test.js: FAIL (${failures})`); process.exit(1); }
  console.log('http-config.test.js: PASS');
}

run().catch(e => { console.error(e); process.exit(1); });
