'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const TOKEN_FILE = '/tmp/vl-agent-token';
const SERVER = path.resolve(__dirname, '../services/http-server/index.js');
const PORT = 3091;

function waitHealthz(ms = 4000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function check() {
      http.get(`http://127.0.0.1:${PORT}/healthz`, res => {
        if (res.statusCode === 200) return resolve();
        if (Date.now() > deadline) return reject(new Error('healthz timeout'));
        setTimeout(check, 200);
      }).on('error', () => {
        if (Date.now() > deadline) return reject(new Error('healthz timeout'));
        setTimeout(check, 200);
      });
    })();
  });
}

(async () => {
  // Clean up any leftover token file before starting
  try { fs.unlinkSync(TOKEN_FILE); } catch {}

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });

  try {
    // Wait for server to be ready
    await waitHealthz();

    // Token file must exist
    assert.ok(fs.existsSync(TOKEN_FILE), 'token file should exist after server starts');
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    assert.ok(token.length > 0, 'token should be non-empty');

    // Kill server and wait briefly for cleanup
    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));

    // Token file must be deleted
    assert.ok(!fs.existsSync(TOKEN_FILE), 'token file should be deleted after server exits');

    console.log('cli-server-token: PASS');
  } catch (err) {
    child.kill();
    throw err;
  }
})().catch(err => { console.error(err); process.exit(1); });
