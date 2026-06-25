'use strict';
/**
 * Integration test: aborting the article step clears opencode_session_id from task.meta and DB.
 *
 * Uses a mini HTTP server to simulate opencode without a real installation:
 *   GET  /global/health          → 200  (opencode_server_ensure health check passes)
 *   POST /session                → {id} (createOpencodeSession gets a session id)
 *   POST /session/{id}/message   → HANG (keeps generate_article.sh alive for the abort window)
 *
 * OPENCODE_PORT is set to the mini server port so both the Node helper and the bash scripts
 * hit it instead of a real opencode process.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const orchestrator = require('../core/orchestrator');
const { createDb } = require('../core/orchestrator/db');
const { getWorkRoot } = require('../core/paths');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_SESSION_ID = 'abort-test-session-001';

function startMiniServer() {
  return new Promise((resolve, reject) => {
    const hangingSockets = [];

    const server = http.createServer((req, res) => {
      req.on('data', () => {}); // drain body
      req.on('end', () => {
        if (req.method === 'GET' && req.url === '/global/health') {
          res.writeHead(200);
          res.end('ok');
        } else if (req.method === 'POST' && req.url === '/session') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: TEST_SESSION_ID }));
        } else if (req.method === 'POST' && /\/session\/[^/]+\/message/.test(req.url)) {
          // Never respond — keeps curl alive until the process is killed
          hangingSockets.push(res);
          server.emit('messageHit');
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    server.listen(0, '127.0.0.1', () => resolve({ server, hangingSockets }));
    server.on('error', reject);
  });
}

function waitForMessageHit(server, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (server.listenerCount('messageHit') > 0) { resolve(); return; }
    const t = setTimeout(() => reject(new Error('Timed out waiting for llm_engine.sh to hit /message')), timeoutMs);
    server.once('messageHit', () => { clearTimeout(t); resolve(); });
  });
}

async function run() {
  const { server, hangingSockets } = await startMiniServer();
  const port = server.address().port;

  const origPort = process.env.OPENCODE_PORT;
  const origEngine = process.env.WRITING_ENGINE;
  process.env.OPENCODE_PORT = String(port);
  process.env.WRITING_ENGINE = 'opencode'; // ensure bash scripts use opencode path

  let taskId;
  try {
    // Create task
    const { task_id } = await orchestrator.createTask({
      url: `https://www.youtube.com/watch?v=aborttest${Date.now()}`,
      focus: '',
      mode: 'full',
      output_lang: 'zh-CN',
      rootDir: ROOT_DIR,
    });
    taskId = task_id;

    // Place a minimal transcript so generate_article.sh can start (single-call path, <60 min)
    const transcriptDir = path.join(getWorkRoot(ROOT_DIR), taskId, 'transcript');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(transcriptDir, 'original_en.md'),
      '# Abort Test Transcript\n\nThis is a minimal transcript for testing abort cleanup.\n'
    );

    // Start article step — don't await, it will hang at POST /session/.../message
    const runStepPromise = orchestrator.runStep(taskId, 'article', { rootDir: ROOT_DIR });

    // Wait until llm_engine.sh actually hits the /message endpoint (robust: no fixed sleep)
    await waitForMessageHit(server);

    // Now abort — sends SIGTERM to process group, killing generate_article.sh + curl
    await orchestrator.abortStep(taskId, 'article', { rootDir: ROOT_DIR });

    const result = await runStepPromise;
    assert.strictEqual(result.success, false, 'runStep must report failure on abort');
    assert.strictEqual(result.error, 'aborted', 'runStep must report "aborted"');

    // In-memory meta cleared
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    assert.strictEqual(
      task.meta.opencode_session_id,
      null,
      'task.meta.opencode_session_id must be null after article abort'
    );

    // DB cleared
    const db = createDb(ROOT_DIR);
    const row = db.getTask(taskId);
    assert.strictEqual(
      row.opencode_session_id,
      null,
      'DB opencode_session_id must be null after article abort'
    );

    console.log('opencode-session-abort: all tests passed');
  } finally {
    // Release hanging sockets so server can close cleanly
    for (const res of hangingSockets) {
      try { res.destroy(); } catch (_) {}
    }
    await new Promise(r => server.close(r));

    // Restore env
    if (origPort !== undefined) process.env.OPENCODE_PORT = origPort;
    else delete process.env.OPENCODE_PORT;
    if (origEngine !== undefined) process.env.WRITING_ENGINE = origEngine;
    else delete process.env.WRITING_ENGINE;

    if (taskId) {
      try { await orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode: 'hard' }); } catch (_) {}
    }
  }
}

run().catch(e => { console.error(e); process.exit(1); });
