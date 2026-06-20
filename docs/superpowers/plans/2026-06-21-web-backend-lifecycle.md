# Web 端后端生命周期管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让浏览器关闭 tab 后端能自动检测并关闭，同时 100% 保留现有 CLI / API 心跳协议。

**Architecture:** 将 SSE 长连接的 TCP 状态作为浏览器侧被动保活信号，注入 `services/http-server/index.js` 既有的 `AUTO_SHUTDOWN` 循环。新增 `cli/commands/web.js` 负责"spawn 后端 + 打开浏览器 + 立即退出"。浏览器侧零代码改动。

**Tech Stack:** Node.js (Koa, koa-router) · 现有 `core/agent-connect.js` · 现有 `EventStream` · 无新增依赖。

**Spec:** `docs/superpowers/specs/2026-06-21-web-backend-lifecycle-design.md`

## Global Constraints

- 现有 CLI 和 API 客户端的心跳调用路径（`POST /api/heartbeat`、`DELETE /api/heartbeat/:id`、`core/heartbeat-client.js`、`core/agent-connect.js`）**禁止修改**
- 后端单例端口固定 `127.0.0.1:3000`
- 测试不使用框架，遵循 `tests/*.test.js` + `node tests/<file>.test.js` 模式
- `AUTO_SHUTDOWN` 仅在 `process.env.AUTO_SHUTDOWN === '1'` 时启用，本计划保留这一行为
- 提交粒度：每个 Task 末尾一次提交；提交不跳过 hook
- 分支：`feature/web-backend-lifecycle`（在 `master` 分支不得直接提交）

---

## File Structure

### 后端
| 文件 | 改动 | 责任 |
|---|---|---|
| `services/http-server/index.js` | 修改 | 新增 `sseRegistry` Set；SSE handler 注册/注销；auto-shutdown 判断条件改为 OR |
| `tests/sse-presence.test.js` | 新建 | SSE 连接 → registry 增减验证 |
| `tests/auto-shutdown-mixed.test.js` | 新建 | 三种 client 混合场景 |

### CLI
| 文件 | 改动 | 责任 |
|---|---|---|
| `cli/commands/web.js` | 新建 | `vdl web` 子命令实现 |
| `cli/index.js` | 修改 | 注册 `web` 子命令、更新 usage 文本 |
| `tests/cli-web-command.test.js` | 新建 | mock `agent-connect` 与 `open` 调用 |

### 文档
| 文件 | 改动 | 责任 |
|---|---|---|
| `docs/how-to/run-web.md` | 新建 | 用户文档：如何启动 web 端、关闭流程 |

---

## Task 1: 后端 — SSE 连接注入 sseRegistry

**Files:**
- Modify: `services/http-server/index.js`
- Test: `tests/sse-presence.test.js`

**Interfaces:**
- Consumes: 既有 `createApp(options)` 工厂、既有 `/api/events` SSE handler
- Produces:
  - `app.context.sseRegistry: Set<string>` —— 暴露给测试和 auto-shutdown 循环
  - SSE 连接建立时 `sseRegistry.add(sseId)`；`req.on('close' | 'error')` 时 `sseRegistry.delete(sseId)`

- [ ] **Step 1.1: 写失败测试**

创建 `tests/sse-presence.test.js`：

```javascript
'use strict';
const assert = require('assert');
const http = require('http');
const { createApp } = require('../services/http-server');

const TOKEN = 'sse-presence-test-token';

function openSse(baseUrl) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}/api/events?token=${TOKEN}`, (res) => {
      res.setEncoding('utf8');
      res.on('data', () => {}); // drain
      resolve({ req, res });
    });
    req.on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const app = createApp({ token: TOKEN });
  const server = http.createServer(app.callback());
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // sseRegistry must be exposed on app.context
  assert.ok(app.context.sseRegistry instanceof Set, 'app.context.sseRegistry must be a Set');
  assert.strictEqual(app.context.sseRegistry.size, 0, 'starts empty');

  // Open 1st connection
  const c1 = await openSse(baseUrl);
  await sleep(150);
  assert.strictEqual(app.context.sseRegistry.size, 1, 'one connection registered');

  // Open 2nd connection
  const c2 = await openSse(baseUrl);
  await sleep(150);
  assert.strictEqual(app.context.sseRegistry.size, 2, 'two connections registered');

  // Close 1st
  c1.req.destroy();
  await sleep(200);
  assert.strictEqual(app.context.sseRegistry.size, 1, 'one connection after first close');

  // Close 2nd
  c2.req.destroy();
  await sleep(200);
  assert.strictEqual(app.context.sseRegistry.size, 0, 'empty after both close');

  server.close();
  console.log('sse-presence: PASS');
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 1.2: 运行测试，确认失败**

```bash
node tests/sse-presence.test.js
```
Expected: 报错 `app.context.sseRegistry must be a Set`（未定义 / undefined）。

- [ ] **Step 1.3: 实现 — 新建 sseRegistry**

在 `services/http-server/index.js` 中，紧挨着 `const heartbeatRegistry = new Map();`（约 line 37）下面新增：

```javascript
  // --- SSE connection registry ---
  // Active SSE connection ids. Browser tabs are tracked via this set;
  // the existing heartbeatRegistry continues to track CLI/API clients.
  const sseRegistry = new Set();
```

- [ ] **Step 1.4: 实现 — SSE handler 注册/注销**

在 `/api/events` handler 内（约 line 139 `const heartbeat = setInterval` 之前），先生成 id 并注册：

```javascript
    const sseId = crypto.randomUUID();
    sseRegistry.add(sseId);
```

在 `cleanup` 函数（约 line 144）末尾追加注销：

```javascript
    const cleanup = () => {
      clearInterval(heartbeat);
      try {
        unsubscribe();
      } catch (_) {
        // ignore
      }
      sseRegistry.delete(sseId);
    };
```

`crypto` 模块在文件顶部已 `require`，无需新增 import。

- [ ] **Step 1.5: 实现 — 暴露到 app.context**

在文件中既有的 `app.context.heartbeatRegistry = heartbeatRegistry;`（约 line 784）下方追加：

```javascript
  app.context.sseRegistry = sseRegistry;
```

- [ ] **Step 1.6: 运行测试，确认通过**

```bash
node tests/sse-presence.test.js
```
Expected: `sse-presence: PASS`

- [ ] **Step 1.7: 回归测试**

```bash
node tests/heartbeat-endpoints.test.js
node tests/service-client-sse.test.js
```
Expected: 两者均 PASS（未影响既有路径）。

- [ ] **Step 1.8: 提交**

```bash
git add services/http-server/index.js tests/sse-presence.test.js
git commit -m "feat(http-server): track active SSE connections in sseRegistry"
```

---

## Task 2: 后端 — auto-shutdown 判断纳入 sseRegistry

**Files:**
- Modify: `services/http-server/index.js`（auto-shutdown 块，约 line 824-860）
- Test: `tests/auto-shutdown-mixed.test.js`

**Interfaces:**
- Consumes: Task 1 提供的 `app.context.sseRegistry`
- Produces: auto-shutdown 循环判断 `hasClients = heartbeatRegistry.size > 0 || sseRegistry.size > 0`

**说明：** auto-shutdown 是 `require.main === module` 分支里独立运行的逻辑，必须通过子进程方式测试。

- [ ] **Step 2.1: 写失败测试**

创建 `tests/auto-shutdown-mixed.test.js`：

```javascript
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const SERVER = path.resolve(__dirname, '../services/http-server/index.js');

function get(baseUrl, p) {
  return new Promise(resolve => {
    const req = http.get(`${baseUrl}${p}`, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(null));
    req.setTimeout(800, () => { req.destroy(); resolve(null); });
  });
}

function openSse(baseUrl, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}/api/events?token=${token}`, res => {
      res.setEncoding('utf8');
      res.on('data', () => {});
      resolve({ req });
    });
    req.on('error', reject);
  });
}

async function waitDead(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = await get(baseUrl, '/healthz');
    if (code === null) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function waitAlive(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await get(baseUrl, '/healthz')) === 200) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

function pickPort() { return 33000 + Math.floor(Math.random() * 1000); }

async function spawnServer(extraEnv) {
  const port = pickPort();
  const tokenFile = path.join(os.tmpdir(), `vl-token-${port}`);
  const pidFile = path.join(os.tmpdir(), `vl-pid-${port}`);
  const env = {
    ...process.env,
    PORT: String(port),
    AGENT_EVENTS_TOKEN: 'mixed-test-token',
    AUTO_SHUTDOWN: '1',
    AUTO_SHUTDOWN_EVICT_MS: '300',
    AUTO_SHUTDOWN_GRACE_MS: '300',
    AUTO_SHUTDOWN_INTERVAL_MS: '100',
    TOKEN_FILE: tokenFile,
    PID_FILE: pidFile,
    ...extraEnv,
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' });
  const baseUrl = `http://127.0.0.1:${port}`;
  if (!(await waitAlive(baseUrl, 4000))) {
    try { child.kill(); } catch (_) {}
    throw new Error('server did not become ready');
  }
  return { child, baseUrl, port, tokenFile, pidFile };
}

(async () => {
  const TOKEN = 'mixed-test-token';

  // Case A: no clients → shuts down within evict+grace window
  {
    const { child, baseUrl } = await spawnServer({});
    const dead = await waitDead(baseUrl, 3000);
    assert.ok(dead, 'expected shutdown with no clients');
    try { child.kill(); } catch (_) {}
    console.log('case A (no clients → shutdown): ok');
  }

  // Case B: SSE-only client keeps backend alive
  {
    const { child, baseUrl } = await spawnServer({});
    const sse = await openSse(baseUrl, TOKEN);
    await new Promise(r => setTimeout(r, 1500)); // > evict+grace
    const code = await get(baseUrl, '/healthz');
    assert.strictEqual(code, 200, 'SSE client should keep server alive');
    sse.req.destroy();
    const dead = await waitDead(baseUrl, 3000);
    assert.ok(dead, 'expected shutdown after SSE closes');
    try { child.kill(); } catch (_) {}
    console.log('case B (SSE keeps alive, then shutdown): ok');
  }

  // Case C: heartbeat client keeps backend alive (regression)
  {
    const { child, baseUrl } = await spawnServer({});
    const intervalId = setInterval(() => {
      const body = JSON.stringify({ clientId: 'c1' });
      const req = http.request({
        hostname: '127.0.0.1', port: new URL(baseUrl).port, path: '/api/heartbeat', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                   'Authorization': `Bearer ${TOKEN}` }
      }, res => res.resume());
      req.on('error', () => {});
      req.write(body); req.end();
    }, 100);
    await new Promise(r => setTimeout(r, 1500));
    const code = await get(baseUrl, '/healthz');
    assert.strictEqual(code, 200, 'heartbeat client should keep alive');
    clearInterval(intervalId);
    const dead = await waitDead(baseUrl, 3000);
    assert.ok(dead, 'expected shutdown after heartbeat stops');
    try { child.kill(); } catch (_) {}
    console.log('case C (heartbeat keeps alive, then shutdown): ok');
  }

  console.log('auto-shutdown-mixed: PASS');
})().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2.2: 运行测试，确认失败**

```bash
node tests/auto-shutdown-mixed.test.js
```
Expected: Case B 失败 —— 因为当前 auto-shutdown 只看 heartbeatRegistry，SSE 客户端不计入，1.5s 内会被关掉。

- [ ] **Step 2.3: 实现 — 修改 auto-shutdown 判断**

在 `services/http-server/index.js` 的 auto-shutdown 循环内（约 line 842），把：

```javascript
      const hasClients = registry.size > 0;
```

替换为：

```javascript
      const sseReg = app.context.sseRegistry;
      const hasClients = registry.size > 0 || (sseReg && sseReg.size > 0);
```

- [ ] **Step 2.4: 运行测试，确认通过**

```bash
node tests/auto-shutdown-mixed.test.js
```
Expected: `auto-shutdown-mixed: PASS`

- [ ] **Step 2.5: 回归（关键）**

```bash
node tests/heartbeat-endpoints.test.js
node tests/heartbeat-client.test.js
node tests/agent-connect.test.js
node tests/sse-presence.test.js
```
Expected: 全部 PASS。

- [ ] **Step 2.6: 提交**

```bash
git add services/http-server/index.js tests/auto-shutdown-mixed.test.js
git commit -m "feat(http-server): include SSE connections in auto-shutdown decision"
```

---

## Task 3: CLI — `vdl web` 子命令

**Files:**
- Create: `cli/commands/web.js`
- Modify: `cli/index.js`
- Test: `tests/cli-web-command.test.js`

**Interfaces:**
- Consumes: `core/agent-connect.connect({ noHeartbeat: true })` —— 既有 API，详见 `core/agent-connect.js:62-130`
- Produces:
  - 子命令模块：`module.exports = { run(args: string[]): Promise<void> }`
  - `run` 末尾调用 `process.exit(0)`，终端立即回 prompt
  - 支持 flags：`--no-browser`（跳过 open）、`--port <n>`（覆盖默认 3000）

- [ ] **Step 3.1: 写失败测试**

创建 `tests/cli-web-command.test.js`：

```javascript
'use strict';
const assert = require('assert');
const path = require('path');
const Module = require('module');

// Stub agent-connect and child_process before requiring the command.
const stubs = {
  connectCalls: [],
  spawnCalls: [],
  exitCode: null,
};

const realResolve = Module._resolveFilename;
const realRequire = Module.prototype.require;

const agentConnectPath = require.resolve('../core/agent-connect');
const cpPath = 'child_process';

Module.prototype.require = function (id) {
  if (id === '../../core/agent-connect' || id === path.relative(path.join(__dirname, '../cli/commands'), agentConnectPath).replace(/\\/g, '/')) {
    return {
      connect: async (opts) => { stubs.connectCalls.push(opts); return { baseUrl: opts.baseUrl || 'http://127.0.0.1:3000', token: 't', heartbeatHandle: null }; },
    };
  }
  if (id === 'child_process') {
    const real = realRequire.call(this, id);
    return {
      ...real,
      spawn: (cmd, args, opts) => { stubs.spawnCalls.push({ cmd, args, opts }); return { unref() {}, on() {} }; },
    };
  }
  return realRequire.call(this, id);
};

// Capture process.exit
const realExit = process.exit;
process.exit = (code) => { stubs.exitCode = code; throw new Error(`__exit:${code}`); };

(async () => {
  // Need a clean cache for the command module
  delete require.cache[require.resolve('../cli/commands/web')];
  const { run } = require('../cli/commands/web');

  // Case 1: default — connects with noHeartbeat:true and opens browser
  stubs.connectCalls.length = 0;
  stubs.spawnCalls.length = 0;
  stubs.exitCode = null;
  try { await run([]); } catch (e) { if (!String(e.message).startsWith('__exit:')) throw e; }
  assert.strictEqual(stubs.connectCalls.length, 1, 'connect called once');
  assert.strictEqual(stubs.connectCalls[0].noHeartbeat, true, 'connect called with noHeartbeat:true');
  assert.strictEqual(stubs.spawnCalls.length, 1, 'spawn called once (browser open)');
  assert.ok(['open', 'xdg-open', 'cmd'].includes(stubs.spawnCalls[0].cmd), `unexpected opener: ${stubs.spawnCalls[0].cmd}`);
  const openArgs = stubs.spawnCalls[0].args.join(' ');
  assert.ok(openArgs.includes('http://127.0.0.1:3000'), `expected URL in args, got: ${openArgs}`);
  assert.strictEqual(stubs.exitCode, 0, 'process.exit(0)');

  // Case 2: --no-browser skips opener
  stubs.connectCalls.length = 0;
  stubs.spawnCalls.length = 0;
  stubs.exitCode = null;
  delete require.cache[require.resolve('../cli/commands/web')];
  const { run: run2 } = require('../cli/commands/web');
  try { await run2(['--no-browser']); } catch (e) { if (!String(e.message).startsWith('__exit:')) throw e; }
  assert.strictEqual(stubs.spawnCalls.length, 0, '--no-browser skips spawn');
  assert.strictEqual(stubs.exitCode, 0);

  // Case 3: --port overrides
  stubs.connectCalls.length = 0;
  stubs.spawnCalls.length = 0;
  stubs.exitCode = null;
  delete require.cache[require.resolve('../cli/commands/web')];
  const { run: run3 } = require('../cli/commands/web');
  try { await run3(['--port', '4000']); } catch (e) { if (!String(e.message).startsWith('__exit:')) throw e; }
  assert.strictEqual(stubs.connectCalls[0].baseUrl, 'http://127.0.0.1:4000', 'baseUrl reflects --port');
  assert.ok(stubs.spawnCalls[0].args.join(' ').includes('http://127.0.0.1:4000'));

  process.exit = realExit;
  console.log('cli-web-command: PASS');
})().catch(err => { process.exit = realExit; console.error(err); process.exit(1); });
```

- [ ] **Step 3.2: 运行测试，确认失败**

```bash
node tests/cli-web-command.test.js
```
Expected: `Cannot find module '../cli/commands/web'`

- [ ] **Step 3.3: 实现 `cli/commands/web.js`**

创建 `cli/commands/web.js`：

```javascript
// cli/commands/web.js
'use strict';
const { spawn } = require('child_process');
const { connect } = require('../../core/agent-connect');

function parseArgs(argv) {
  const out = { port: 3000, openBrowser: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-browser') out.openBrowser = false;
    else if (a === '--port') out.port = Number(argv[++i]);
  }
  if (!Number.isInteger(out.port) || out.port <= 0) {
    throw new Error(`invalid --port value: ${out.port}`);
  }
  return out;
}

function openInBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === 'darwin')      { cmd = 'open';     args = [url]; }
  else if (platform === 'win32')  { cmd = 'cmd';      args = ['/c', 'start', '', url]; }
  else                            { cmd = 'xdg-open'; args = [url]; }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {
    process.stderr.write(`(unable to open browser; visit ${url} manually)\n`);
  });
  child.unref();
}

async function run(argv = []) {
  const { port, openBrowser } = parseArgs(argv);
  const baseUrl = `http://127.0.0.1:${port}`;

  await connect({ baseUrl, noHeartbeat: true });

  if (openBrowser) {
    openInBrowser(baseUrl);
  }

  process.stdout.write(`Backend running on ${baseUrl}\n`);
  process.stdout.write(`Close the browser tab when done — backend will shut down automatically.\n`);
  process.exit(0);
}

module.exports = { run };
```

- [ ] **Step 3.4: 运行测试，确认通过**

```bash
node tests/cli-web-command.test.js
```
Expected: `cli-web-command: PASS`

- [ ] **Step 3.5: 注册子命令到 `cli/index.js`**

在 `cli/index.js` 的 `commands` 对象中加一行（保持字母序无要求，紧挨 `gui` 即可）：

```javascript
const commands = {
  status: () => require('./commands/status').run(args.slice(1)),
  result: () => require('./commands/result').run(args.slice(1)),
  rerun:  () => require('./commands/rerun').run(args.slice(1)),
  list:   () => require('./commands/list').run(args.slice(1)),
  gui:    () => require('./commands/gui').run(),
  web:    () => require('./commands/web').run(args.slice(1)),
};
```

并更新 `printUsage()` 文本，在 `vdl gui` 行下方增加：

```
  vdl web [--no-browser] [--port <n>]
                     启动后端并打开 Web 端（关闭浏览器后自动停止后端）
```

- [ ] **Step 3.6: 回归子命令路由**

```bash
node tests/cli-subcommands.test.js
node tests/cli-commands.test.js
```
Expected: 全部 PASS。

- [ ] **Step 3.7: 提交**

```bash
git add cli/commands/web.js cli/index.js tests/cli-web-command.test.js
git commit -m "feat(cli): add 'vdl web' to spawn backend and open browser"
```

---

## Task 4: 用户文档

**Files:**
- Create: `docs/how-to/run-web.md`

- [ ] **Step 4.1: 写文档**

创建 `docs/how-to/run-web.md`：

```markdown
# 如何运行 Web 端

## 启动

```bash
vdl web
```

行为：

1. 如本机没有后端进程，自动启动一个（监听 `127.0.0.1:3000`）
2. 自动打开默认浏览器到 `http://127.0.0.1:3000`
3. CLI 命令立即返回，终端可继续做别的事

## 关闭

直接关闭浏览器 tab。后端会在约 30 秒内自动退出。

机制：浏览器通过 SSE 长连接被后端追踪；连接断开后，若同时没有其他 CLI / API 客户端在使用，进入 grace 期后自动 shutdown。

## 可选参数

| 参数 | 说明 |
|---|---|
| `--no-browser` | 只启动后端，不打开浏览器（用于远程访问 / 自动化） |
| `--port <n>`   | 覆盖默认端口 3000 |

## 与 CLI 任务共存

`vdl web` 启动的后端与 `vdl <URL>` 提交任务用的是同一个进程。多端可以同时使用：

```bash
# 终端 A
vdl web

# 终端 B（同时）
vdl https://www.youtube.com/watch?v=...
```

后端会等到所有客户端（浏览器 tab + CLI 任务进程）都离开后才退出。

## 故障排查

| 现象 | 排查 |
|---|---|
| `Backend running on ...` 但浏览器没打开 | macOS 检查 `open` 命令；Linux 检查 `xdg-open`；可手动访问打印的 URL |
| 浏览器显示 `connection refused` | 后端已 shutdown，重新跑 `vdl web` |
| `vdl web` 报 `Agent HTTP server failed to start` | 端口被占用，参考 `docs/explanation/singleton-backend.md` |
```

- [ ] **Step 4.2: 提交**

```bash
git add docs/how-to/run-web.md
git commit -m "docs: add how-to guide for 'vdl web'"
```

---

## Task 5: 端到端冒烟（手动）

**目的：** 在真实进程下确认完整路径。无新增代码，纯人工 / 半自动验证。

- [ ] **Step 5.1: 启动并验证打开**

```bash
node cli/index.js web
```
Expected:
- 终端输出 `Backend running on http://127.0.0.1:3000`
- 默认浏览器打开 `127.0.0.1:3000`
- 终端立即回到 prompt（不挂起）

- [ ] **Step 5.2: 验证 SSE 注册**

```bash
curl -s -H "Authorization: Bearer $(cat /tmp/vl-agent-token)" \
  http://127.0.0.1:3000/api/heartbeat/status
```
Expected: `clientCount: 0`（CLI 用 `noHeartbeat` 没注册心跳；浏览器只走 SSE，不进 heartbeatRegistry —— 正确）。

- [ ] **Step 5.3: 关闭浏览器 tab，观察后端退出**

关闭浏览器 tab。在终端持续观察：

```bash
while curl -fs http://127.0.0.1:3000/healthz > /dev/null; do echo alive; sleep 5; done; echo SHUTDOWN
```

Expected: 30-60 秒后 `SHUTDOWN`。

- [ ] **Step 5.4: 验证现有 CLI 任务不受影响**

```bash
node cli/index.js web --no-browser
node cli/index.js list
```
Expected: `list` 子命令正常返回（heartbeat 路径完好）。

测试通过后 Ctrl+C 终止 list 等待，重新关浏览器（或不开浏览器场景下等 evict）让 backend 退出。

- [ ] **Step 5.5: 提交（如有微调）**

若上面任何一步暴露问题，回到对应 Task 修复并提交；否则本 Task 无提交。

---

## Self-Review

**1. Spec 覆盖**
- ✅ §"架构设计" 三类客户端共用一套裁决 → Task 1+2
- ✅ §"vdl web 子命令" → Task 3
- ✅ §"后端改动（极小）" → Task 1+2
- ✅ §"前端改动（零）" → 无前端 Task（spec 明确零改动）
- ✅ §"测试策略" → tests/sse-presence + tests/auto-shutdown-mixed + tests/cli-web-command
- ✅ §"隔离性保证" → Task 2 Step 2.5 显式回归 heartbeat 路径
- ✅ §"风险 1（后端已停时浏览器访问）" → docs/how-to/run-web.md 故障排查表覆盖
- ✅ §"不在本期范围" 中的"`--detach`、远程访问、Terminal 唤起、错误页 UI 细节" → 计划中均未实现，符合预期

**2. Placeholder 扫描**
- 全文无 TBD / TODO / "implement later" / "add appropriate error handling"
- 每个 step 含具体代码或具体命令

**3. 类型 / 签名一致性**
- `connect({ noHeartbeat: true })` 选项与 `core/agent-connect.js` Phase 1/2 实现一致
- `app.context.sseRegistry` 在 Task 1 创建、Task 2 消费，命名一致（Set 类型）
- `cli/commands/web.js` 的 `run(argv)` 签名与 `cli/index.js` 的调用一致（`args.slice(1)`）
- `process.exit(0)` 行为与 spec §"数据流：启动" 一致

— 计划完成。

---

## Plan complete and saved to `docs/superpowers/plans/2026-06-21-web-backend-lifecycle.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
