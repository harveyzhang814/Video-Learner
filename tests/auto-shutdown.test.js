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

  // ---- Test C: getActiveTaskCount() correctly gates auto-shutdown ----
  // In-process: verifies the counter that the shutdown check relies on.
  // Scenario: CLI creates task → CLI exits (heartbeat stops) →
  //           backend stays alive until task done → backend exits.
  {
    const orchestrator = require('../core/orchestrator');
    const os = require('os');
    const tmp3 = fs.mkdtempSync(require('path').join(os.tmpdir(), 'vl-shutdown-c-'));

    // Before any task: counter is 0 → shutdown would proceed
    assert.strictEqual(orchestrator.getActiveTaskCount(), 0,
      'C: initial getActiveTaskCount=0');

    // Create task and fire runTask (simulates CLI creating task then exiting)
    const { task_id } = await orchestrator.createTask({
      url: 'https://example.com/watch?v=shutdown-test',
      mode: 'transcript',
      rootDir: tmp3,
    });
    const runPromise = orchestrator.runTask(task_id, { rootDir: tmp3 });

    // Immediately after runTask() call: counter is 1 (incremented synchronously
    // before first await) → shutdown check sees hasRunningTasks=true → deferred
    assert.strictEqual(orchestrator.getActiveTaskCount(), 1,
      'C: getActiveTaskCount=1 while task running — shutdown deferred');

    // Wait for task to finish (will fail: fake URL, no yt-dlp output expected)
    await runPromise.catch(() => {});

    // After task ends: counter drops to 0 → shutdown check can now proceed
    assert.strictEqual(orchestrator.getActiveTaskCount(), 0,
      'C: getActiveTaskCount=0 after task done — shutdown can proceed');
  }

  // ---- Test D: server exits AFTER task completes, not before ----
  // Subprocess test: spawn server, register client, start task, deregister client,
  // verify server stays alive while task runs, verify server exits after task ends.
  {
    try { fs.unlinkSync(TOKEN_FILE); } catch {}
    const childD = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PORT: String(PORT),
        TOKEN_FILE,
        PID_FILE,
        AUTO_SHUTDOWN: '1',
        AUTO_SHUTDOWN_EVICT_MS:    '200',
        AUTO_SHUTDOWN_GRACE_MS:    '200',
        AUTO_SHUTDOWN_INTERVAL_MS: '100',
      },
      stdio: 'ignore',
    });
    await waitHealthz(baseUrl);
    const tokenD = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

    // Register client (simulates CLI connecting)
    await apiReq('POST', '/api/heartbeat', tokenD, PORT, { clientId: 'cli-d' });

    // Create a task via HTTP (fire-and-forget; increments activeRunTasks)
    await apiReq('POST', '/api/tasks', tokenD, PORT, {
      url: 'https://example.com/watch?v=shutdown-d',
      mode: 'transcript',
    });

    // Small pause so runTask's synchronous increment registers before we
    // deregister the client. The task itself runs asynchronously.
    await new Promise(r => setTimeout(r, 50));

    // Deregister client (simulates CLI exiting)
    await apiReq('DELETE', `/api/heartbeat/cli-d`, tokenD, PORT);

    // Server must still be alive just after deregister — task is running.
    // Grace window is 200 ms; check immediately.
    const aliveStatus = await new Promise(resolve => {
      http.get(`${baseUrl}/healthz`, res => resolve(res.statusCode))
          .on('error', () => resolve(null));
    });
    assert.strictEqual(aliveStatus, 200,
      'D: server still alive immediately after client exit (task running)');

    // Wait for server to exit on its own (task fails → activeRunTasks=0 →
    // grace 200 ms → exit). Budget: task up to 8 s + grace 200 ms + buffer 2 s.
    const exitedD = await new Promise(resolve => {
      childD.once('exit', code => resolve(code ?? 0));
      setTimeout(() => resolve(null), 12000);
    });
    assert.ok(exitedD !== null,
      'D: server should exit automatically after task completes and no clients remain');
    assert.ok(!fs.existsSync(TOKEN_FILE), 'D: token file cleaned on exit');
    assert.ok(!fs.existsSync(PID_FILE),   'D: PID file cleaned on exit');
  }

  console.log('auto-shutdown: PASS');
})().catch(err => { console.error(err); process.exit(1); });
