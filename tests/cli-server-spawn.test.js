'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Use a unique port and token file to avoid conflicts with other tests
const PORT = 3093;
const TOKEN_FILE = '/tmp/vl-agent-token-spawn-test';
const SERVER_ENTRY = path.resolve(__dirname, 'helpers/minimal-server.js');
const HEALTHZ_URL = `http://127.0.0.1:${PORT}/healthz`;

// Require a fresh copy of server.js (module cache may hold _managedChild state)
delete require.cache[require.resolve('../cli/lib/server')];
const serverLib = require('../cli/lib/server');

(async () => {
  // Ensure no leftover token file
  try { fs.unlinkSync(TOKEN_FILE); } catch {}

  // --- Test: ensureServer spawns a new server when none running ---
  assert.ok(!serverLib.didSpawn(), 'should not have spawned before test');

  const token = await serverLib.ensureServer({
    healthzUrl: HEALTHZ_URL,
    tokenFile: TOKEN_FILE,
    serverEntry: SERVER_ENTRY,
    extraEnv: { PORT: String(PORT), CLI_TEST_TOKEN_FILE: TOKEN_FILE },
  });

  assert.ok(typeof token === 'string' && token.length > 0, 'should return a token');
  assert.ok(serverLib.didSpawn(), 'should have spawned a child');
  assert.ok(fs.existsSync(TOKEN_FILE), 'token file should exist after spawn');
  const fileToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  assert.strictEqual(fileToken, token, 'token file should contain the returned token');

  // --- Test: shutdown kills child and deletes token file ---
  serverLib.shutdown(TOKEN_FILE);
  await new Promise(r => setTimeout(r, 300)); // allow process to exit

  assert.ok(!serverLib.didSpawn(), 'didSpawn should be false after shutdown');
  assert.ok(!fs.existsSync(TOKEN_FILE), 'token file should be deleted after shutdown');

  console.log('cli-server-spawn: PASS');
})().catch(err => { console.error(err); process.exit(1); });
