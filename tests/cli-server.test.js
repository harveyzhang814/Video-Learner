'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const { createApp } = require('../services/http-server');

const TOKEN_FILE = '/tmp/vl-agent-token-test2';
const PORT = 3098;
const TOKEN = 'cli-server-test-token';

async function startTestServer() {
  const app = createApp({ token: TOKEN });
  return new Promise(r => {
    const srv = http.createServer(app.callback()).listen(PORT, '127.0.0.1', () => r(srv));
  });
}

const serverLib = require('../cli/lib/server');

(async () => {
  // --- Test 1: ensureServer reuses existing server ---
  const srv = await startTestServer();
  fs.writeFileSync(TOKEN_FILE, TOKEN);

  const token = await serverLib.ensureServer({
    healthzUrl: `http://127.0.0.1:${PORT}/healthz`,
    tokenFile: TOKEN_FILE,
  });
  assert.strictEqual(token, TOKEN);
  assert.ok(!serverLib.didSpawn(), 'should not have spawned a new server');

  fs.unlinkSync(TOKEN_FILE);
  srv.close();

  // --- Test 2: ensureServer errors if server running but no token file ---
  const srv2 = await startTestServer();
  try {
    await serverLib.ensureServer({
      healthzUrl: `http://127.0.0.1:${PORT}/healthz`,
      tokenFile: TOKEN_FILE,
    });
    assert.fail('should throw');
  } catch (err) {
    assert.ok(/token/i.test(err.message), `unexpected error: ${err.message}`);
  }
  srv2.close();

  console.log('cli-server: PASS');
})().catch(err => { console.error(err); process.exit(1); });
