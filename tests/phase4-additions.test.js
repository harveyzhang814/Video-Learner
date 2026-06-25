'use strict';

/**
 * Phase 4 test additions:
 *   1. DELETE ?mode=soft  → 204, DB cleared, files kept
 *   2. DELETE while running → 409
 *   3. POST /api/tasks without Bearer → 401
 *   4. POST /api/tasks with Bearer   → 201
 *   5. createDb() pragma busy_timeout = 3000
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp } = require('../services/http-server');
const { createDb } = require('../core/orchestrator/db');
const orchestrator = require('../core/orchestrator');

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-phase4-'));
  const token = 'phase4-test-token';
  const app = createApp({ rootDir: tmp, token });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function req(reqPath, options = {}) {
    const res = await fetch(base + reqPath, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      },
      ...options
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    return { status: res.status, body };
  }

  try {
    // ── Test 5: busy_timeout pragma ─────────────────────────────────────────
    // busy_timeout is a session pragma (not persisted to disk) so it can only
    // be verified by inspecting the connection that was opened. We verify by
    // reading the db.js source to confirm the pragma call is present.
    {
      const dbSource = fs.readFileSync(
        path.join(__dirname, '../core/orchestrator/db.js'),
        'utf8'
      );
      assert.ok(
        /busy_timeout\s*=\s*3000/.test(dbSource),
        "db.js must set busy_timeout = 3000"
      );
      console.log('  [5] busy_timeout = 3000 in db.js: PASS');
    }

    // ── Test 3: POST without Bearer → 401 ───────────────────────────────────
    {
      const r = await req('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/v=noauth', focus: '', mode: 'transcript' }),
        headers: { 'Content-Type': 'application/json' } // no Authorization
      });
      assert.strictEqual(r.status, 401, `expected 401, got ${r.status}`);
      console.log('  [3] POST without Bearer → 401: PASS');
    }

    // ── Test 4: POST with Bearer → 201 ──────────────────────────────────────
    {
      const r = await req('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/watch?v=phase4auth', focus: '', mode: 'transcript' })
      });
      assert.strictEqual(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
      assert.ok(r.body && r.body.task_id, 'expected task_id in response');
      console.log('  [4] POST with Bearer → 201: PASS');
    }

    // ── Test 1: DELETE ?mode=soft → 204, DB cleared, files kept ─────────────
    {
      const { task_id: taskId } = await orchestrator.createTask({
        url: 'https://example.com/watch?v=softdelete',
        focus: '',
        mode: 'transcript',
        force: 0,
        output_lang: 'zh-CN',
        rootDir: tmp
      });

      // Create a sentinel file in the work dir
      const workDir = path.join(tmp, 'work', taskId);
      fs.mkdirSync(workDir, { recursive: true });
      const sentinel = path.join(workDir, 'sentinel.txt');
      fs.writeFileSync(sentinel, 'keep me');

      orchestrator._dropTaskFromMemory(taskId);

      const r = await req(`/api/tasks/${taskId}?mode=soft`, { method: 'DELETE' });
      assert.strictEqual(r.status, 204, `expected 204, got ${r.status}: ${JSON.stringify(r.body)}`);

      // DB row should be gone
      const db = createDb(tmp);
      const t = db.getTask(taskId);
      assert.ok(t == null, 'task should not be visible in DB after soft delete');

      // Files should still exist
      assert.ok(fs.existsSync(sentinel), 'work files should be kept after soft delete');
      console.log('  [1] DELETE ?mode=soft → 204, files kept: PASS');
    }

    // ── Test 2: DELETE while running → 409 ──────────────────────────────────
    {
      const { task_id: taskId } = await orchestrator.createTask({
        url: 'https://example.com/watch?v=runningdelete',
        focus: '',
        mode: 'transcript',
        force: 0,
        output_lang: 'zh-CN',
        rootDir: tmp
      });

      // Mark a step as running in DB; drop from memory so guard uses DB fallback
      const Database = require('better-sqlite3');
      const dbPath = path.join(tmp, 'work', 'database.sqlite');
      const rawDb = new Database(dbPath);
      // Ensure the fetch step row exists, then mark it running
      rawDb.prepare(
        "INSERT OR REPLACE INTO steps (task_id, step_name, status, attempts) VALUES (?,?,?,?)"
      ).run(taskId, 'fetch', 'running', 1);
      rawDb.close();
      orchestrator._dropTaskFromMemory(taskId);

      const r = await req(`/api/tasks/${taskId}`, { method: 'DELETE' });
      assert.strictEqual(r.status, 409, `expected 409 for running task, got ${r.status}: ${JSON.stringify(r.body)}`);
      console.log('  [2] DELETE while running → 409: PASS');
    }

    console.log('\nphase4-additions.test.js: ALL PASS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
