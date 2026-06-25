'use strict';
const assert = require('assert');
const http = require('http');
const { createOpencodeSession, isOpencodeSessionUsable } = require('../core/opencode-session');

// Override global.fetch for mock tests; restores after each call.
async function withMockFetch(mockFn, fn) {
  const orig = global.fetch;
  global.fetch = mockFn;
  try { return await fn(); } finally { global.fetch = orig; }
}

function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function run() {
  // --- export shape ---
  assert.strictEqual(typeof createOpencodeSession, 'function', 'createOpencodeSession must be exported');
  assert.strictEqual(typeof isOpencodeSessionUsable, 'function', 'isOpencodeSessionUsable must be exported');

  // --- server-down: graceful degradation (no throw) ---
  assert.strictEqual(await createOpencodeSession(19999), null, 'create: unreachable server → null');
  assert.strictEqual(await isOpencodeSessionUsable('any-id', 19999), false, 'usable: unreachable server → false');
  assert.strictEqual(await isOpencodeSessionUsable(null, 19999), false, 'usable: null sessionId → false (no fetch)');
  assert.strictEqual(await isOpencodeSessionUsable('', 19999), false, 'usable: empty sessionId → false (no fetch)');

  // --- mock fetch: createOpencodeSession success paths ---
  await withMockFetch(
    async () => ({ ok: true, json: async () => ({ id: 'sess-abc' }) }),
    async () => assert.strictEqual(await createOpencodeSession(1), 'sess-abc', 'create: 200 with string id → id string')
  );

  await withMockFetch(
    async () => ({ ok: true, json: async () => ({ id: '' }) }),
    async () => assert.strictEqual(await createOpencodeSession(1), null, 'create: empty string id → null')
  );

  await withMockFetch(
    async () => ({ ok: true, json: async () => ({ id: null }) }),
    async () => assert.strictEqual(await createOpencodeSession(1), null, 'create: null id in JSON → null')
  );

  await withMockFetch(
    async () => ({ ok: true, json: async () => ({}) }),
    async () => assert.strictEqual(await createOpencodeSession(1), null, 'create: missing id field → null')
  );

  await withMockFetch(
    async () => ({ ok: false, status: 500, json: async () => ({}) }),
    async () => assert.strictEqual(await createOpencodeSession(1), null, 'create: HTTP 500 → null')
  );

  // --- mock fetch: isOpencodeSessionUsable success paths ---
  await withMockFetch(
    async () => ({ ok: true, json: async () => [{ id: 'msg-1', role: 'assistant' }] }),
    async () => assert.strictEqual(await isOpencodeSessionUsable('s', 1), true, 'usable: 200 + non-empty array → true')
  );

  await withMockFetch(
    // empty array = session created but article went chunked (no single session message)
    async () => ({ ok: true, json: async () => [] }),
    async () => assert.strictEqual(await isOpencodeSessionUsable('s', 1), false, 'usable: 200 + empty array → false (chunked case)')
  );

  await withMockFetch(
    async () => ({ ok: false, status: 404 }),
    async () => assert.strictEqual(await isOpencodeSessionUsable('s', 1), false, 'usable: 404 → false')
  );

  await withMockFetch(
    async () => ({ ok: true, json: async () => 'not-an-array' }),
    async () => assert.strictEqual(await isOpencodeSessionUsable('s', 1), false, 'usable: non-array JSON → false')
  );

  // --- mini HTTP server: real fetch against a local server ---
  const server = await startServer((req, res) => {
    req.resume(); // drain body
    if (req.method === 'POST' && req.url === '/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'mini-server-session-001' }));
    } else if (req.method === 'GET' && /\/session\/[^/]+\/message/.test(req.url)) {
      // Encode messages presence in the session id prefix for routing
      const hasMessages = req.url.includes('with-msg');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(hasMessages ? JSON.stringify([{ role: 'assistant', text: 'hello' }]) : '[]');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const port = server.address().port;
  try {
    const id = await createOpencodeSession(port);
    assert.strictEqual(id, 'mini-server-session-001', 'mini-server: createOpencodeSession returns id from real HTTP');

    const usableWithMsg = await isOpencodeSessionUsable('with-msg-session', port);
    assert.strictEqual(usableWithMsg, true, 'mini-server: session with messages → true');

    const usableEmpty = await isOpencodeSessionUsable('empty-session', port);
    assert.strictEqual(usableEmpty, false, 'mini-server: session with no messages → false (chunked isolation)');
  } finally {
    await stopServer(server);
  }

  console.log('opencode-session: all 16 tests passed');
}

run().catch((e) => { console.error(e); process.exit(1); });
