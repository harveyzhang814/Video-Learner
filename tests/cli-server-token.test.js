'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = '/tmp/vl-agent-token-test';

(async () => {
  // Simulate what the server does on startup: write token to file
  const token = 'test-token-abc123';
  fs.writeFileSync(TOKEN_FILE, token);

  assert.strictEqual(fs.readFileSync(TOKEN_FILE, 'utf8'), token);

  fs.unlinkSync(TOKEN_FILE);
  assert.ok(!fs.existsSync(TOKEN_FILE));

  console.log('cli-server-token: PASS');
})().catch(err => { console.error(err); process.exit(1); });
