'use strict';
const assert = require('assert');
const { createOpencodeSession, isOpencodeSessionUsable } = require('../core/opencode-session');

async function run() {
  assert.strictEqual(typeof createOpencodeSession, 'function', 'createOpencodeSession must be exported');
  assert.strictEqual(typeof isOpencodeSessionUsable, 'function', 'isOpencodeSessionUsable must be exported');

  // Port 19999 is guaranteed unused — both functions must return null/false without throwing
  const sessionId = await createOpencodeSession(19999);
  assert.strictEqual(sessionId, null, 'createOpencodeSession should return null when server unreachable');

  const usable = await isOpencodeSessionUsable('nonexistent-id', 19999);
  assert.strictEqual(usable, false, 'isOpencodeSessionUsable should return false when server unreachable');

  console.log('opencode-session tests: all passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
