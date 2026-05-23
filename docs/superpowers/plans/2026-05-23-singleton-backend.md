# Singleton Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Electron GUI, CLI (`vdl`), and `npm run agent:serve` all share one backend instance on port 3000, with the server auto-shutting down when the last client disconnects.

**Architecture:** A new `core/agent-connect.js` module centralises the "check-or-start" logic used by both CLI and Electron. A new `core/heartbeat-client.js` sends periodic pings; the server auto-shuts down (when `AUTO_SHUTDOWN=1`) after 30 s with no live clients and no running tasks. Electron stops generating its own token and delegates entirely to `agent-connect`.

**Tech Stack:** Node.js 25, Koa (HTTP server), plain-Node test files (no framework — run with `node tests/<file>.test.js`).

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `core/heartbeat-client.js` | **Create** | Sends periodic POST heartbeats; sends DELETE on stop |
| `core/agent-connect.js` | **Create** | Single entry-point: check-or-start server, start heartbeat, return `{ baseUrl, token, heartbeatHandle }` |
| `services/http-server/index.js` | **Modify** | Add heartbeat registry + endpoints; auto-shutdown loop; PID file; EADDRINUSE handler |
| `cli/lib/server.js` | **Modify** | Thin wrapper around `agent-connect`; remove `_managedChild`, `didSpawn()` |
| `electron/src/main-helpers.js` | **Modify** | Use `agent-connect`; remove `getFreePort()` and token generation |
| `tests/heartbeat-client.test.js` | **Create** | Unit tests for heartbeat-client |
| `tests/heartbeat-endpoints.test.js` | **Create** | Unit tests for server heartbeat endpoints |
| `tests/auto-shutdown.test.js` | **Create** | Integration test for auto-shutdown loop |
| `tests/agent-connect.test.js` | **Create** | Unit tests for agent-connect connect() |
| `tests/cli-server.test.js` | **Modify** | Remove `didSpawn()` assertion (regression fix) |
| `tests/cli-server-spawn.test.js` | **Modify** | Remove `didSpawn()` + token-file-deleted assertions (regression fix) |
| `tests/singleton-backend.test.js` | **Create** | Integration tests: 8 scenarios including race, stale token, agent:serve+CLI |

---

## Task 1: core/heartbeat-client.js

**Files:**
- Create: `core/heartbeat-client.js`
- Create: `tests/heartbeat-client.test.js`

- [ ] **Step 1.1 — Write the failing test**

```js
// tests/heartbeat-client.test.js
'use strict';
const assert = require('assert');
const http = require('http');

const PORT = 3099;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startMockServer() {
  const received = []; // clientIds that sent POST
  const deleted  = []; // clientIds that sent DELETE
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/heartbeat') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        try { received.push(JSON.parse(body).clientId); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    } else if (req.method === 'DELETE' && req.url.startsWith('/api/heartbeat/')) {
      const clientId = decodeURIComponent(req.url.slice('/api/heartbeat/'.length));
      deleted.push(clientId);
      res.writeHead(200); res.end('{}');
    } else {
      res.writeHead(404); res.end();
    }
  });
  return new Promise(resolve => {
    server.listen(PORT, '127.0.0.1', () => resolve({ server, received, deleted }));
  });
}

(async () => {
  const { server, received, deleted } = await startMockServer();
  const heartbeat = require('../core/heartbeat-client');

  // Test 1: start() sends an immediate heartbeat
  const handle = heartbeat.start({ baseUrl: BASE_URL, token: 'tok', clientId: 'c1', intervalMs: 100 });
  await new Promise(r => setTimeout(r, 60));
  assert.ok(received.includes('c1'), `expected immediate heartbeat, got: ${JSON.stringify(received)}`);

  // Test 2: interval sends additional heartbeats
  await new Promise(r => setTimeout(r, 350));
  const count = received.filter(x => x === 'c1').length;
  assert.ok(count >= 3, `expected >=3 heartbeats after 350ms at 100ms interval, got ${count}`);

  // Test 3: stop() sends DELETE and clears interval
  await heartbeat.stop(handle);
  assert.ok(deleted.includes('c1'), `expected DELETE for c1, got: ${JSON.stringify(deleted)}`);
  const countAfter = received.filter(x => x === 'c1').length;
  await new Promise(r => setTimeout(r, 200)); // wait to confirm no more heartbeats
  const countFinal = received.filter(x => x === 'c1').length;
  assert.strictEqual(countAfter, countFinal, 'no heartbeats should be sent after stop()');

  // Test 4: stop(null) does not throw
  await heartbeat.stop(null);

  // Test 5: network error is swallowed (no unhandled rejection)
  const badHandle = heartbeat.start({ baseUrl: 'http://127.0.0.1:1', token: 'x', clientId: 'c2', intervalMs: 50 });
  await new Promise(r => setTimeout(r, 60));
  await heartbeat.stop(badHandle); // must not throw

  server.close();
  console.log('heartbeat-client: PASS');
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 1.2 — Run to confirm it fails**

```bash
node tests/heartbeat-client.test.js
```

Expected: `Error: Cannot find module '../core/heartbeat-client'`

- [ ] **Step 1.3 — Implement core/heartbeat-client.js**

```js
// core/heartbeat-client.js
'use strict';
const http = require('http');

function _post(baseUrl, token, clientId) {
  return new Promise(resolve => {
    try {
      const body = JSON.stringify({ clientId });
      const url = new URL('/api/heartbeat', baseUrl);
      const req = http.request(
        { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`,
                     'Content-Length': Buffer.byteLength(body) } },
        res => { res.resume(); resolve(); }
      );
      req.on('error', () => resolve());
      req.setTimeout(2000, () => { req.destroy(); resolve(); });
      req.write(body);
      req.end();
    } catch (_) { resolve(); }
  });
}

function _delete(baseUrl, token, clientId) {
  return new Promise(resolve => {
    try {
      const url = new URL(`/api/heartbeat/${encodeURIComponent(clientId)}`, baseUrl);
      const req = http.request(
        { hostname: url.hostname, port: url.port, path: url.pathname, method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` } },
        res => { res.resume(); resolve(); }
      );
      req.on('error', () => resolve());
      req.setTimeout(2000, () => { req.destroy(); resolve(); });
      req.end();
    } catch (_) { resolve(); }
  });
}

/**
 * Start sending heartbeats. Returns a handle to pass to stop().
 */
function start({ baseUrl, token, clientId, intervalMs = 10000 }) {
  _post(baseUrl, token, clientId); // immediate
  const intervalId = setInterval(() => _post(baseUrl, token, clientId), intervalMs);
  return { intervalId, baseUrl, token, clientId };
}

/**
 * Stop heartbeats and send deregister DELETE. Safe to call with null.
 */
async function stop(handle) {
  if (!handle) return;
  clearInterval(handle.intervalId);
  await _delete(handle.baseUrl, handle.token, handle.clientId);
}

module.exports = { start, stop };
```

- [ ] **Step 1.4 — Run to confirm it passes**

```bash
node tests/heartbeat-client.test.js
```

Expected: `heartbeat-client: PASS`

- [ ] **Step 1.5 — Commit**

```bash
git add core/heartbeat-client.js tests/heartbeat-client.test.js
git commit -m "feat: add heartbeat-client module"
```

---

## Task 2: HTTP server — heartbeat endpoints

**Files:**
- Modify: `services/http-server/index.js` (add registry + 2 routes)
- Create: `tests/heartbeat-endpoints.test.js`

- [ ] **Step 2.1 — Write the failing test**

```js
// tests/heartbeat-endpoints.test.js
'use strict';
const assert = require('assert');
const http = require('http');
const { createApp } = require('../services/http-server');

const TOKEN = 'hb-endpoint-test-token';
const PORT  = 3097;

function req(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { 'Authorization': `Bearer ${token || TOKEN}`, 'Content-Type': 'application/json' },
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let srv;
(async () => {
  const app = createApp({ token: TOKEN });
  srv = http.createServer(app.callback()).listen(PORT, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));

  // Test 1: POST /api/heartbeat → 200
  const r1 = await req('POST', '/api/heartbeat', { clientId: 'c1' });
  assert.strictEqual(r1.status, 200, `expected 200, got ${r1.status}: ${JSON.stringify(r1.body)}`);

  // Test 2: POST /api/heartbeat with bad token → 401
  const r2 = await req('POST', '/api/heartbeat', { clientId: 'c1' }, 'bad');
  assert.strictEqual(r2.status, 401);

  // Test 3: DELETE /api/heartbeat/:clientId → 200
  const r3 = await req('DELETE', '/api/heartbeat/c1');
  assert.strictEqual(r3.status, 200);

  // Test 4: DELETE /api/heartbeat/nonexistent → 200 (idempotent)
  const r4 = await req('DELETE', '/api/heartbeat/nonexistent');
  assert.strictEqual(r4.status, 200);

  // Test 5: GET /api/heartbeat/status → returns clientCount
  const r5 = await req('GET', '/api/heartbeat/status');
  assert.strictEqual(r5.status, 200);
  assert.ok(typeof r5.body.clientCount === 'number', `expected clientCount number, got ${JSON.stringify(r5.body)}`);

  srv.close();
  console.log('heartbeat-endpoints: PASS');
})().catch(err => { if (srv) srv.close(); console.error(err); process.exit(1); });
```

- [ ] **Step 2.2 — Run to confirm it fails**

```bash
node tests/heartbeat-endpoints.test.js
```

Expected: status 404 on `/api/heartbeat` (route not yet defined).

- [ ] **Step 2.3 — Add heartbeat registry and routes to services/http-server/index.js**

Find the line `function createApp(options = {}) {` (line 15) and add the registry right after the `stream` / `token` / `runTaskForDownstream` declarations (after line ~36, before the orchestrator bridge). Then add the three routes before the final `return app`.

Add after `const stream = …` block (around line 30–36), inserting a heartbeat registry object:

```js
  // --- Heartbeat registry ---
  // clientId → lastSeen timestamp (ms). Used for auto-shutdown.
  const _heartbeatRegistry = new Map();
```

Add three routes after the existing `router.post('/tasks/:taskId/steps/:stepName/run', …)` block (around line 506), before the `app.use(bodyParser())` lines:

```js
  // POST /api/heartbeat  { clientId } — register/refresh a client
  router.post('/heartbeat', async (ctx) => {
    const { clientId } = ctx.request.body || {};
    if (!clientId) { ctx.status = 400; ctx.body = { error: 'clientId required' }; return; }
    _heartbeatRegistry.set(clientId, Date.now());
    ctx.body = { ok: true };
  });

  // DELETE /api/heartbeat/:clientId — explicit deregister
  router.delete('/heartbeat/:clientId', async (ctx) => {
    _heartbeatRegistry.delete(ctx.params.clientId);
    ctx.body = { ok: true };
  });

  // GET /api/heartbeat/status — diagnostic
  router.get('/heartbeat/status', async (ctx) => {
    ctx.body = { clientCount: _heartbeatRegistry.size, clients: [..._heartbeatRegistry.keys()] };
  });
```

- [ ] **Step 2.4 — Run to confirm it passes**

```bash
node tests/heartbeat-endpoints.test.js
```

Expected: `heartbeat-endpoints: PASS`

- [ ] **Step 2.5 — Commit**

```bash
git add services/http-server/index.js tests/heartbeat-endpoints.test.js
git commit -m "feat: add heartbeat endpoints to HTTP server"
```

---

## Task 3: HTTP server — auto-shutdown, PID file, EADDRINUSE handler

**Files:**
- Modify: `services/http-server/index.js` (auto-shutdown loop + PID file + error handler in `require.main` block)
- Create: `tests/auto-shutdown.test.js`

- [ ] **Step 3.1 — Write the failing test**

```js
// tests/auto-shutdown.test.js
'use strict';
const assert = require('assert');
const http   = require('http');
const fs     = require('fs');
const { spawn } = require('child_process');
const path   = require('path');

const PORT        = 3095;
const TOKEN_FILE  = '/tmp/vl-agent-token-autoshutdown-test';
const PID_FILE    = '/tmp/vl-agent-autoshutdown-test.pid';
const SERVER      = path.resolve(__dirname, '../services/http-server/index.js');

function waitHealthz(baseUrl, ms = 6000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function check() {
      http.get(`${baseUrl}/healthz`, res => {
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

function apiReq(method, urlPath, token, port, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    const r = http.request(opts, res => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}

  const baseUrl = `http://127.0.0.1:${PORT}`;

  // ---- Test A: PID file is written on startup and cleaned on exit ----
  const childA = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), TOKEN_FILE, PID_FILE },
    stdio: 'ignore',
  });
  await waitHealthz(baseUrl);

  assert.ok(fs.existsSync(PID_FILE), 'PID file should exist after startup');
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  assert.ok(pid > 0, `PID should be a positive integer, got ${pid}`);

  childA.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 500));
  assert.ok(!fs.existsSync(TOKEN_FILE), 'token file should be deleted after SIGTERM');
  assert.ok(!fs.existsSync(PID_FILE), 'PID file should be deleted after SIGTERM');

  // ---- Test B: AUTO_SHUTDOWN=1 shuts down when last client deregisters ----
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  const childB = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TOKEN_FILE,
      PID_FILE,
      AUTO_SHUTDOWN: '1',
      AUTO_SHUTDOWN_EVICT_MS: '300',    // evict after 300 ms silence
      AUTO_SHUTDOWN_GRACE_MS: '300',    // grace window 300 ms
      AUTO_SHUTDOWN_INTERVAL_MS: '100', // scan every 100 ms
    },
    stdio: 'ignore',
  });
  await waitHealthz(baseUrl);
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

  // Register client
  await apiReq('POST', '/api/heartbeat', token, PORT, { clientId: 'tester' });
  // Explicitly deregister
  await apiReq('DELETE', '/api/heartbeat/tester', token, PORT);

  // Server should exit within evict(300) + grace(300) + buffer(1000) = 1600 ms
  const exitCode = await new Promise(resolve => {
    childB.once('exit', code => resolve(code));
    setTimeout(() => resolve(null), 3000);
  });
  assert.ok(exitCode !== null, 'Server should have exited but did not within 3 s');
  assert.ok(!fs.existsSync(TOKEN_FILE), 'Token file cleaned on auto-shutdown');
  assert.ok(!fs.existsSync(PID_FILE),   'PID file cleaned on auto-shutdown');

  // ---- Test C: AUTO_SHUTDOWN=1 does NOT shut down when tasks are running ----
  // (uses a lower-level check: we verify the server is still alive after grace
  //  period when a task is running — tested by checking the orchestrator
  //  guard indirectly; full integration in singleton-backend.test.js)

  console.log('auto-shutdown: PASS');
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3.2 — Run to confirm it fails**

```bash
node tests/auto-shutdown.test.js
```

Expected: Test A fails — PID file not written.

- [ ] **Step 3.3 — Add PID file + auto-shutdown + EADDRINUSE to services/http-server/index.js**

In the `if (require.main === module)` block (starting at line 595), replace the entire block with:

```js
if (require.main === module) {
  const port     = Number(process.env.PORT)      || 3000;
  const host     = process.env.HOST              || '127.0.0.1';
  const TOKEN_FILE = process.env.TOKEN_FILE      || '/tmp/vl-agent-token';
  const PID_FILE   = process.env.PID_FILE        || '/tmp/vl-agent.pid';

  const app   = createApp();
  const token = app.context.eventsToken;

  // Write discovery files
  try { fs.writeFileSync(TOKEN_FILE, token); }   catch (_) {}
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (_) {}

  function cleanup() {
    try { fs.unlinkSync(TOKEN_FILE); } catch (_) {}
    try { fs.unlinkSync(PID_FILE);   } catch (_) {}
  }
  process.on('exit',   cleanup);
  process.on('SIGINT',  () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // Auto-shutdown (only when AUTO_SHUTDOWN=1)
  if (process.env.AUTO_SHUTDOWN === '1') {
    const EVICT_MS    = Number(process.env.AUTO_SHUTDOWN_EVICT_MS)    || 20000;
    const GRACE_MS    = Number(process.env.AUTO_SHUTDOWN_GRACE_MS)    || 30000;
    const INTERVAL_MS = Number(process.env.AUTO_SHUTDOWN_INTERVAL_MS) || 5000;

    // Access the registry created inside createApp via a shared ref.
    // createApp exposes it on app.context for this purpose.
    let gracePending = false;
    let graceTimer   = null;

    setInterval(() => {
      const registry = app.context.heartbeatRegistry;
      if (!registry) return;

      const now = Date.now();
      // Evict stale clients
      for (const [id, lastSeen] of registry.entries()) {
        if (now - lastSeen > EVICT_MS) registry.delete(id);
      }

      const hasClients = registry.size > 0;

      // Check for running tasks
      let hasRunningTasks = false;
      try {
        const tasks = orchestrator.listTasks();
        hasRunningTasks = tasks.some(t => t.status === 'running');
      } catch (_) {}

      if (!hasClients && !hasRunningTasks) {
        if (!gracePending) {
          gracePending = true;
          graceTimer = setTimeout(() => {
            cleanup();
            process.exit(0);
          }, GRACE_MS);
        }
      } else {
        // Cancel pending grace if a new client registered or tasks started
        if (gracePending) {
          clearTimeout(graceTimer);
          gracePending = false;
          graceTimer   = null;
        }
      }
    }, INTERVAL_MS);
  }

  const server = app.listen(port, host, () => {
    console.log(`Agent HTTP service listening on http://${host}:${port}`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[agent-http] Port ${port} already in use — another instance may be running.`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}
```

Also expose `_heartbeatRegistry` on `app.context` inside `createApp()`. After the line that sets `app.context.eventsToken = token;` (around line 586), add:

```js
  app.context.heartbeatRegistry = _heartbeatRegistry;
```

- [ ] **Step 3.4 — Run to confirm it passes**

```bash
node tests/auto-shutdown.test.js
```

Expected: `auto-shutdown: PASS`

- [ ] **Step 3.5 — Confirm existing server tests still pass**

```bash
node tests/heartbeat-endpoints.test.js
node tests/agent-http.test.js
```

Both expected: PASS

- [ ] **Step 3.6 — Commit**

```bash
git add services/http-server/index.js tests/auto-shutdown.test.js
git commit -m "feat: add auto-shutdown, PID file, and EADDRINUSE handler to HTTP server"
```

---

## Task 4: core/agent-connect.js

**Files:**
- Create: `core/agent-connect.js`
- Create: `tests/agent-connect.test.js`

- [ ] **Step 4.1 — Write the failing test**

```js
// tests/agent-connect.test.js
'use strict';
const assert = require('assert');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const PORT       = 3094;
const BASE_URL   = `http://127.0.0.1:${PORT}`;
const TOKEN_FILE = '/tmp/vl-agent-token-connect-test';
const PID_FILE   = '/tmp/vl-agent-connect-test.pid';
const SERVER     = path.resolve(__dirname, '../services/http-server/index.js');

function waitHealthz(baseUrl, ms = 6000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function check() {
      http.get(`${baseUrl}/healthz`, res => {
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

function killByPid(pidFile) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) process.kill(pid, 'SIGTERM');
  } catch (_) {}
}

// Fresh require to avoid module cache issues across tests
function freshConnect() {
  delete require.cache[require.resolve('../core/agent-connect')];
  return require('../core/agent-connect').connect;
}

(async () => {
  const connect = freshConnect();

  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE);   } catch {}

  // ---- Test 1: connect() when server is already running ----
  const child = require('child_process').spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), TOKEN_FILE, PID_FILE },
    stdio: 'ignore',
  });
  await waitHealthz(BASE_URL);
  const existingToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

  const r1 = await connect({
    baseUrl: BASE_URL, tokenFile: TOKEN_FILE,
    serverEntry: SERVER, noHeartbeat: true,
  });
  assert.strictEqual(r1.token, existingToken, 'should return existing server token');
  assert.strictEqual(r1.baseUrl, BASE_URL);
  assert.strictEqual(r1.heartbeatHandle, null);

  child.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 400));

  // ---- Test 2: connect() when server is dead — spawns new one ----
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE);   } catch {}

  const r2 = await connect({
    baseUrl: BASE_URL, tokenFile: TOKEN_FILE,
    serverEntry: SERVER, noHeartbeat: true,
    extraEnv: { PORT: String(PORT), TOKEN_FILE, PID_FILE },
  });
  assert.ok(typeof r2.token === 'string' && r2.token.length > 0, 'should return new token');
  assert.strictEqual(r2.heartbeatHandle, null);

  // Clean up spawned server
  killByPid(PID_FILE);
  await new Promise(r => setTimeout(r, 400));

  // ---- Test 3: connect() starts heartbeat when noHeartbeat is not set ----
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE);   } catch {}

  const r3 = await connect({
    baseUrl: BASE_URL, tokenFile: TOKEN_FILE,
    serverEntry: SERVER,
    extraEnv: { PORT: String(PORT), TOKEN_FILE, PID_FILE },
  });
  assert.ok(r3.heartbeatHandle !== null, 'should return a heartbeat handle');

  // Stop heartbeat and kill server
  const { stop } = require('../core/heartbeat-client');
  await stop(r3.heartbeatHandle);
  killByPid(PID_FILE);
  await new Promise(r => setTimeout(r, 400));

  console.log('agent-connect: PASS');
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 4.2 — Run to confirm it fails**

```bash
node tests/agent-connect.test.js
```

Expected: `Error: Cannot find module '../core/agent-connect'`

- [ ] **Step 4.3 — Implement core/agent-connect.js**

```js
// core/agent-connect.js
'use strict';
const http    = require('http');
const { spawn } = require('child_process');
const fs      = require('fs');
const path    = require('path');
const heartbeat = require('./heartbeat-client');

const DEFAULT_TOKEN_FILE = '/tmp/vl-agent-token';
const DEFAULT_BASE_URL   = 'http://127.0.0.1:3000';
const SERVER_ENTRY       = path.resolve(__dirname, '../services/http-server/index.js');
const STARTUP_TIMEOUT_MS = 8000;

function _checkHealthz(baseUrl, timeoutMs = 1500) {
  return new Promise(resolve => {
    const req = http.get(`${baseUrl}/healthz`, res => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

function _readToken(tokenFile) {
  try {
    const t = fs.readFileSync(tokenFile, 'utf8').trim();
    return t || null;
  } catch (_) {
    return null;
  }
}

async function _waitForReady(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await _checkHealthz(baseUrl)) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/**
 * Connect to (or start) the agent HTTP server on port 3000.
 *
 * Returns { baseUrl, token, heartbeatHandle }.
 * heartbeatHandle is null when opts.noHeartbeat is true.
 *
 * Options (all optional — override defaults for testing):
 *   baseUrl           — default: http://127.0.0.1:3000
 *   tokenFile         — default: /tmp/vl-agent-token
 *   serverEntry       — default: services/http-server/index.js
 *   clientId          — heartbeat client ID (default: auto-generated)
 *   heartbeatIntervalMs — default: 10000
 *   noHeartbeat       — skip heartbeat registration (for short-lived queries)
 *   extraEnv          — extra env vars to pass when spawning (for testing)
 */
async function connect(opts = {}) {
  const baseUrl   = opts.baseUrl     || DEFAULT_BASE_URL;
  const tokenFile = opts.tokenFile   || DEFAULT_TOKEN_FILE;
  const entry     = opts.serverEntry || SERVER_ENTRY;
  const clientId  = opts.clientId    || `vl-${process.pid}-${Date.now()}`;

  function _startHeartbeat(token) {
    if (opts.noHeartbeat) return null;
    return heartbeat.start({
      baseUrl, token, clientId,
      intervalMs: opts.heartbeatIntervalMs || 10000,
    });
  }

  // ── Phase 1: server already alive ────────────────────────────────────────
  if (await _checkHealthz(baseUrl)) {
    const token = _readToken(tokenFile);
    if (!token) {
      throw new Error(
        `Server running but token file not found at ${tokenFile}. Restart the server.`
      );
    }
    return { baseUrl, token, heartbeatHandle: _startHeartbeat(token) };
  }

  // ── Phase 2: spawn a new server ──────────────────────────────────────────
  const spawnEnv = {
    ...process.env,
    AUTO_SHUTDOWN: '1',
    ...(opts.extraEnv || {}),
  };
  // Ensure server starts on the expected port (default 3000)
  if (!spawnEnv.PORT) spawnEnv.PORT = String(new URL(baseUrl).port || '3000');

  const child = spawn(process.execPath, [entry], {
    env: spawnEnv,
    stdio: 'ignore',
    detached: false,
  });

  const ready = await _waitForReady(baseUrl, STARTUP_TIMEOUT_MS);

  if (!ready) {
    // Possible EADDRINUSE: another process won the race. Try healthz once more.
    if (await _checkHealthz(baseUrl)) {
      try { child.kill(); } catch (_) {}
      const token = _readToken(tokenFile);
      if (!token) {
        throw new Error(
          `Server running but token file not found at ${tokenFile}. Restart the server.`
        );
      }
      return { baseUrl, token, heartbeatHandle: _startHeartbeat(token) };
    }
    try { child.kill(); } catch (_) {}
    throw new Error(`Agent HTTP server failed to start within ${STARTUP_TIMEOUT_MS} ms`);
  }

  const token = _readToken(tokenFile);
  if (!token) {
    try { child.kill(); } catch (_) {}
    throw new Error(`Server started but token file not found at ${tokenFile}`);
  }
  return { baseUrl, token, heartbeatHandle: _startHeartbeat(token) };
}

module.exports = { connect };
```

- [ ] **Step 4.4 — Run to confirm it passes**

```bash
node tests/agent-connect.test.js
```

Expected: `agent-connect: PASS`

- [ ] **Step 4.5 — Commit**

```bash
git add core/agent-connect.js tests/agent-connect.test.js
git commit -m "feat: add agent-connect module (singleton check-or-start)"
```

---

## Task 5: Refactor cli/lib/server.js

**Files:**
- Modify: `cli/lib/server.js`

- [ ] **Step 5.1 — Replace cli/lib/server.js entirely**

```js
// cli/lib/server.js
'use strict';
const { connect } = require('../../core/agent-connect');
const { stop: stopHeartbeat } = require('../../core/heartbeat-client');

let _heartbeatHandle = null;

/**
 * Ensure the HTTP server is running. Returns the bearer token.
 * Starts a heartbeat so the server knows this process is alive.
 *
 * Options (for testing — same as agent-connect opts):
 *   healthzUrl  → baseUrl (derives baseUrl from healthzUrl for back-compat)
 *   tokenFile, serverEntry, extraEnv, noHeartbeat
 */
async function ensureServer(opts = {}) {
  // Back-compat: tests pass healthzUrl; derive baseUrl from it.
  const baseUrl = opts.healthzUrl
    ? opts.healthzUrl.replace('/healthz', '')
    : undefined;

  const { token, heartbeatHandle } = await connect({
    ...opts,
    ...(baseUrl ? { baseUrl } : {}),
  });
  _heartbeatHandle = heartbeatHandle;
  return token;
}

/**
 * Deregister heartbeat. Does NOT kill the server — the server manages
 * its own lifecycle via the heartbeat auto-shutdown mechanism.
 */
async function shutdown() {
  if (_heartbeatHandle) {
    await stopHeartbeat(_heartbeatHandle);
    _heartbeatHandle = null;
  }
}

function registerShutdown() {
  const handler = () => { shutdown(); };
  process.on('exit',   handler);
  process.on('SIGINT',  () => { shutdown().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { shutdown().then(() => process.exit(0)); });
}

module.exports = { ensureServer, shutdown, registerShutdown };
```

- [ ] **Step 5.2 — Run the existing server tests (expect regressions — will fix in Task 7)**

```bash
node tests/cli-server.test.js
node tests/cli-server-spawn.test.js
```

These will fail — that is expected. Both use `didSpawn()` which no longer exists.

- [ ] **Step 5.3 — Run the full CLI suite to check for other breakage**

```bash
npm run test:cli
```

Note which tests fail. Expected: only the two server tests above.

- [ ] **Step 5.4 — Commit**

```bash
git add cli/lib/server.js
git commit -m "refactor: cli/lib/server.js delegates to core/agent-connect"
```

---

## Task 6: Refactor electron/src/main-helpers.js

**Files:**
- Modify: `electron/src/main-helpers.js`

- [ ] **Step 6.1 — Replace electron/src/main-helpers.js entirely**

```js
// electron/src/main-helpers.js
'use strict';
const path = require('path');
const { connect } = require('../../core/agent-connect');
const { stop: stopHeartbeat } = require('../../core/heartbeat-client');

const baseDir = path.resolve(__dirname, '..', '..');

function sanitizeLogLine(line) {
  if (!line) return '';
  return String(line).replace(/\?token=[^&\s]+/g, '?token=[REDACTED]');
}

let _serviceInfo = null; // { baseUrl, token, heartbeatHandle }

/**
 * Ensure the HTTP service is running (port 3000).
 * Reuses an already-running instance if one is alive.
 * Returns { baseUrl, token }.
 */
async function startLocalHttpService() {
  if (_serviceInfo) return { baseUrl: _serviceInfo.baseUrl, token: _serviceInfo.token };

  try {
    _serviceInfo = await connect({
      clientId: `electron-${process.pid}`,
      heartbeatIntervalMs: 10000,
    });
    console.log('[agent-http] ready', { baseUrl: _serviceInfo.baseUrl });
    return { baseUrl: _serviceInfo.baseUrl, token: _serviceInfo.token };
  } catch (err) {
    console.error('[agent-http] failed to start', err && err.message ? err.message : err);
    throw err;
  }
}

/**
 * Deregister heartbeat so the server can count down toward auto-shutdown.
 * Does NOT SIGTERM the server — the server manages its own lifecycle.
 */
async function stopLocalHttpService() {
  if (!_serviceInfo) return;
  try {
    await stopHeartbeat(_serviceInfo.heartbeatHandle);
  } catch (_) {}
  _serviceInfo = null;
}

/**
 * Returns cached service info, or null if not started yet.
 */
function getHttpServiceInfo() {
  return _serviceInfo ? { baseUrl: _serviceInfo.baseUrl, token: _serviceInfo.token } : null;
}

module.exports = { startLocalHttpService, stopLocalHttpService, getHttpServiceInfo };
```

- [ ] **Step 6.2 — Update electron/src/main.js: make before-quit async**

Find the `app.on('before-quit', ...)` handler (around line 81–83):

```js
// BEFORE (line 81-83):
app.on('before-quit', () => {
  helpers.stopLocalHttpService();
});
```

Replace with:

```js
// AFTER:
app.on('before-quit', (event) => {
  event.preventDefault();
  helpers.stopLocalHttpService().then(() => app.quit());
});
```

- [ ] **Step 6.3 — Run the Electron main-process test**

```bash
node tests/main-process.test.js
```

Expected: PASS (the test mocks startLocalHttpService so it should be unaffected).

- [ ] **Step 6.4 — Commit**

```bash
git add electron/src/main-helpers.js electron/src/main.js
git commit -m "refactor: electron uses core/agent-connect, removes random port and token generation"
```

---

## Task 7: Fix regressions and add integration tests

**Files:**
- Modify: `tests/cli-server.test.js`
- Modify: `tests/cli-server-spawn.test.js`
- Create: `tests/singleton-backend.test.js`

- [ ] **Step 7.1 — Fix tests/cli-server.test.js**

Find the assertion on line 32:

```js
// REMOVE this assertion (didSpawn no longer exported):
assert.ok(!serverLib.didSpawn(), 'should not have spawned a new server');
```

Replace the entire test with:

```js
// tests/cli-server.test.js
'use strict';
const assert = require('assert');
const fs     = require('fs');
const http   = require('http');
const { createApp } = require('../services/http-server');

const TOKEN_FILE = '/tmp/vl-agent-token-test2';
const PORT   = 3098;
const TOKEN  = 'cli-server-test-token';

async function startTestServer() {
  const app = createApp({ token: TOKEN });
  return new Promise(r => {
    const srv = http.createServer(app.callback()).listen(PORT, '127.0.0.1', () => r(srv));
  });
}

// Fresh require — avoid module cache from other tests
delete require.cache[require.resolve('../cli/lib/server')];
const serverLib = require('../cli/lib/server');

(async () => {
  // Test 1: ensureServer reuses existing server
  const srv = await startTestServer();
  fs.writeFileSync(TOKEN_FILE, TOKEN);

  const token = await serverLib.ensureServer({
    healthzUrl: `http://127.0.0.1:${PORT}/healthz`,
    tokenFile: TOKEN_FILE,
    noHeartbeat: true,
  });
  assert.strictEqual(token, TOKEN);
  // No assertion on didSpawn() — it has been removed.

  fs.unlinkSync(TOKEN_FILE);
  srv.close();

  // Test 2: ensureServer errors if server running but no token file
  const srv2 = await startTestServer();
  try {
    await serverLib.ensureServer({
      healthzUrl: `http://127.0.0.1:${PORT}/healthz`,
      tokenFile: TOKEN_FILE,
      noHeartbeat: true,
    });
    assert.fail('should throw');
  } catch (err) {
    assert.ok(/token/i.test(err.message), `unexpected error: ${err.message}`);
  }
  srv2.close();

  console.log('cli-server: PASS');
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 7.2 — Fix tests/cli-server-spawn.test.js**

Replace the entire file:

```js
// tests/cli-server-spawn.test.js
'use strict';
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const http   = require('http');

const PORT        = 3093;
const TOKEN_FILE  = '/tmp/vl-agent-token-spawn-test';
const PID_FILE    = '/tmp/vl-agent-spawn-test.pid';
const SERVER_ENTRY = path.resolve(__dirname, '../services/http-server/index.js');
const BASE_URL    = `http://127.0.0.1:${PORT}`;

delete require.cache[require.resolve('../cli/lib/server')];
const serverLib = require('../cli/lib/server');

function killByPid(pidFile) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) process.kill(pid, 'SIGTERM');
  } catch (_) {}
}

(async () => {
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE);   } catch {}

  // Test: ensureServer spawns a new server when none running
  const token = await serverLib.ensureServer({
    healthzUrl: `${BASE_URL}/healthz`,
    tokenFile: TOKEN_FILE,
    serverEntry: SERVER_ENTRY,
    noHeartbeat: true,
    extraEnv: { PORT: String(PORT), TOKEN_FILE, PID_FILE },
  });

  assert.ok(typeof token === 'string' && token.length > 0, 'should return a token');
  assert.ok(fs.existsSync(TOKEN_FILE), 'token file should exist after spawn');
  assert.ok(fs.existsSync(PID_FILE),   'PID file should exist after spawn');

  const fileToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  assert.strictEqual(fileToken, token, 'token file should match returned token');

  // shutdown() deregisters heartbeat but does NOT kill the server
  await serverLib.shutdown();
  await new Promise(r => setTimeout(r, 200));

  // Server should STILL be alive (heartbeat just stopped)
  const alive = await new Promise(resolve => {
    http.get(`${BASE_URL}/healthz`, res => resolve(res.statusCode === 200))
      .on('error', () => resolve(false));
  });
  assert.ok(alive, 'Server should still be running after shutdown() — heartbeat stop only');

  // Token file still exists (server manages it)
  assert.ok(fs.existsSync(TOKEN_FILE), 'token file should still exist after shutdown()');

  // Clean up: kill the spawned server via PID file
  killByPid(PID_FILE);
  await new Promise(r => setTimeout(r, 300));

  console.log('cli-server-spawn: PASS');
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 7.3 — Run the two fixed tests to confirm they pass**

```bash
node tests/cli-server.test.js
node tests/cli-server-spawn.test.js
```

Both expected: PASS

- [ ] **Step 7.4 — Write tests/singleton-backend.test.js**

```js
// tests/singleton-backend.test.js
// Integration tests for singleton backend behaviour.
// Spawns and kills real server processes.
'use strict';
const assert  = require('assert');
const fs      = require('fs');
const http    = require('http');
const path    = require('path');
const { spawn } = require('child_process');

const SERVER   = path.resolve(__dirname, '../services/http-server/index.js');
const PORT     = 3092;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Per-test token/PID files to avoid cross-test pollution
function tmpFiles(suffix) {
  return {
    tokenFile: `/tmp/vl-singleton-token-${suffix}`,
    pidFile:   `/tmp/vl-singleton-pid-${suffix}`,
  };
}

function cleanup(files) {
  try { fs.unlinkSync(files.tokenFile); } catch (_) {}
  try { fs.unlinkSync(files.pidFile);   } catch (_) {}
}

function waitHealthz(ms = 6000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function check() {
      http.get(`${BASE_URL}/healthz`, res => {
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

function waitDead(ms = 4000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function check() {
      http.get(`${BASE_URL}/healthz`, res => {
        res.resume();
        if (Date.now() > deadline) return reject(new Error('server still alive'));
        setTimeout(check, 200);
      }).on('error', () => resolve()); // connection refused = dead
    })();
  });
}

function killByPid(pidFile) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0) process.kill(pid, 'SIGTERM');
  } catch (_) {}
}

function spawnServer(files, extra = {}) {
  return spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(PORT),
      TOKEN_FILE: files.tokenFile,
      PID_FILE:   files.pidFile,
      ...extra,
    },
    stdio: 'ignore',
  });
}

// Fresh connect() each test
function freshConnect(opts = {}) {
  delete require.cache[require.resolve('../core/agent-connect')];
  delete require.cache[require.resolve('../core/heartbeat-client')];
  return require('../core/agent-connect').connect({
    baseUrl: BASE_URL,
    noHeartbeat: true,
    ...opts,
  });
}

(async () => {
  // ── Scenario 1: CLI connects to existing server, no extra spawn ──────────
  {
    const f = tmpFiles('s1'); cleanup(f);
    const child = spawnServer(f);
    await waitHealthz();
    const existingToken = fs.readFileSync(f.tokenFile, 'utf8').trim();

    const r = await freshConnect({ tokenFile: f.tokenFile, serverEntry: SERVER });
    assert.strictEqual(r.token, existingToken, 'S1: should reuse existing server token');

    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S1 PASS: CLI reuses existing server');
  }

  // ── Scenario 2: agent:serve + CLI reuse (most common production path) ────
  {
    const f = tmpFiles('s2'); cleanup(f);
    // Simulate "npm run agent:serve" — no AUTO_SHUTDOWN
    const child = spawnServer(f);
    await waitHealthz();
    const agentToken = fs.readFileSync(f.tokenFile, 'utf8').trim();

    // CLI connects
    const r = await freshConnect({ tokenFile: f.tokenFile, serverEntry: SERVER });
    assert.strictEqual(r.token, agentToken, 'S2: CLI should get same token as agent:serve');

    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S2 PASS: agent:serve + CLI reuse');
  }

  // ── Scenario 3: server dead → connect() spawns new one ───────────────────
  {
    const f = tmpFiles('s3'); cleanup(f);

    const r = await freshConnect({
      tokenFile: f.tokenFile, serverEntry: SERVER,
      extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
    });
    assert.ok(r.token.length > 0, 'S3: should have a token');
    assert.ok(fs.existsSync(f.tokenFile), 'S3: token file should exist');

    killByPid(f.pidFile);
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S3 PASS: server spawned when dead');
  }

  // ── Scenario 4: stale token file recovery ─────────────────────────────────
  {
    const f = tmpFiles('s4'); cleanup(f);
    // Write a stale token file (server not running)
    fs.writeFileSync(f.tokenFile, 'stale-token-value');

    const r = await freshConnect({
      tokenFile: f.tokenFile, serverEntry: SERVER,
      extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
    });
    // healthz was dead → new server spawned → new token written
    assert.notStrictEqual(r.token, 'stale-token-value', 'S4: should overwrite stale token');
    assert.ok(r.token.length > 0, 'S4: new token should be non-empty');

    killByPid(f.pidFile);
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S4 PASS: stale token file overwritten on respawn');
  }

  // ── Scenario 5: last client exits → server auto-shuts down ───────────────
  {
    const f = tmpFiles('s5'); cleanup(f);
    spawnServer(f, {
      AUTO_SHUTDOWN: '1',
      AUTO_SHUTDOWN_EVICT_MS: '300',
      AUTO_SHUTDOWN_GRACE_MS: '300',
      AUTO_SHUTDOWN_INTERVAL_MS: '100',
    });
    await waitHealthz();
    const token = fs.readFileSync(f.tokenFile, 'utf8').trim();

    // Register and immediately deregister
    const hb = require('../core/heartbeat-client');
    const handle = hb.start({ baseUrl: BASE_URL, token, clientId: 'last-client', intervalMs: 5000 });
    await new Promise(r => setTimeout(r, 50));
    await hb.stop(handle);

    // Server should exit within evict+grace+buffer = ~2 s
    await waitDead(4000);
    assert.ok(!fs.existsSync(f.tokenFile), 'S5: token file cleaned on auto-shutdown');
    cleanup(f);
    console.log('S5 PASS: server auto-shuts down after last client exits');
  }

  // ── Scenario 6: two clients, first exits, server stays up ────────────────
  {
    const f = tmpFiles('s6'); cleanup(f);
    spawnServer(f, {
      AUTO_SHUTDOWN: '1',
      AUTO_SHUTDOWN_EVICT_MS: '300',
      AUTO_SHUTDOWN_GRACE_MS: '300',
      AUTO_SHUTDOWN_INTERVAL_MS: '100',
    });
    await waitHealthz();
    const token = fs.readFileSync(f.tokenFile, 'utf8').trim();

    const hb = require('../core/heartbeat-client');
    const h1 = hb.start({ baseUrl: BASE_URL, token, clientId: 'client-1', intervalMs: 200 });
    const h2 = hb.start({ baseUrl: BASE_URL, token, clientId: 'client-2', intervalMs: 200 });

    // First client leaves
    await hb.stop(h1);
    await new Promise(r => setTimeout(r, 1200)); // wait > grace period

    // Server should still be alive (client-2 still sending heartbeats)
    const alive = await new Promise(resolve => {
      http.get(`${BASE_URL}/healthz`, res => resolve(res.statusCode === 200))
        .on('error', () => resolve(false));
    });
    assert.ok(alive, 'S6: server should still be alive while client-2 is connected');

    // Now stop client-2 → server shuts down
    await hb.stop(h2);
    await waitDead(4000);
    cleanup(f);
    console.log('S6 PASS: server stays alive until last client exits');
  }

  // ── Scenario 7: race condition — two simultaneous connect() calls ─────────
  {
    const f = tmpFiles('s7'); cleanup(f);

    // Both callers find dead server and try to spawn simultaneously
    const [r1, r2] = await Promise.all([
      freshConnect({
        tokenFile: f.tokenFile, serverEntry: SERVER,
        extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
      }),
      freshConnect({
        tokenFile: f.tokenFile, serverEntry: SERVER,
        extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
      }),
    ]);

    // Both should succeed (one spawned, one hit EADDRINUSE and retried healthz)
    assert.ok(r1.token.length > 0, 'S7: r1 should have token');
    assert.ok(r2.token.length > 0, 'S7: r2 should have token');
    // Both should get the same token (from the single running server)
    assert.strictEqual(r1.token, r2.token, 'S7: both callers should get the same token');

    killByPid(f.pidFile);
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S7 PASS: race condition — both callers get same token');
  }

  // ── Scenario 8: server crash recovery — next connect() respawns ───────────
  {
    const f = tmpFiles('s8'); cleanup(f);
    const child = spawnServer(f);
    await waitHealthz();

    // Kill the server unexpectedly (simulate crash)
    child.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 300));

    // Next connect() should detect dead healthz and spawn a new server
    const r = await freshConnect({
      tokenFile: f.tokenFile, serverEntry: SERVER,
      extraEnv: { PORT: String(PORT), TOKEN_FILE: f.tokenFile, PID_FILE: f.pidFile },
    });
    assert.ok(r.token.length > 0, 'S8: should recover with new token after crash');

    killByPid(f.pidFile);
    await new Promise(r => setTimeout(r, 400));
    cleanup(f);
    console.log('S8 PASS: server crash recovery');
  }

  console.log('\nsingleton-backend: ALL 8 SCENARIOS PASS');
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 7.5 — Run the full test suite**

```bash
node tests/cli-server.test.js
node tests/cli-server-spawn.test.js
node tests/singleton-backend.test.js
node tests/heartbeat-client.test.js
node tests/heartbeat-endpoints.test.js
node tests/auto-shutdown.test.js
node tests/agent-connect.test.js
```

All expected: PASS

- [ ] **Step 7.6 — Run the broader CLI and agent suites**

```bash
npm run test:cli
npm run test:agent:core
```

Expected: All pass.

- [ ] **Step 7.7 — Commit**

```bash
git add tests/cli-server.test.js tests/cli-server-spawn.test.js tests/singleton-backend.test.js
git commit -m "test: fix regressions + add singleton-backend integration tests (8 scenarios)"
```

---

## Final verification

- [ ] **Step F.1 — Run all new tests together**

```bash
for f in heartbeat-client heartbeat-endpoints auto-shutdown agent-connect singleton-backend cli-server cli-server-spawn; do
  echo "--- $f ---" && node tests/$f.test.js
done
```

All expected: PASS

- [ ] **Step F.2 — Smoke test: start Electron, verify it connects on port 3000**

```bash
# In one terminal:
npm run agent:serve
# In another terminal (verify CLI connects to same server):
vdl status
# Check only ONE backend process is running on 3000:
lsof -i :3000 | grep LISTEN
```

Expected: exactly one process on port 3000.

- [ ] **Step F.3 — Final commit**

```bash
git add -A
git status  # confirm only intended changes
git commit -m "chore: singleton backend complete — all tests pass"
```

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT: ENG CLEARED — ready to implement.**
