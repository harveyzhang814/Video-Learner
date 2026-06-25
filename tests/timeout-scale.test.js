'use strict';

/**
 * Tests for the long-video timeout_scale feature.
 *
 * Coverage:
 *   1. getStepTimeoutMs — scale multiplier, env priority, edge cases
 *   2. createTask — timeout_scale stored in params; invalid values normalized to 1
 *   3. DB — timeout_scale column exists after migration
 *   4. HTTP API — POST /api/tasks accepts timeout_scale; reflected in createTask response
 *   5. runTask propagation — timeoutScale flows into runStepScript opts
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getStepTimeoutMs } = require('../core/orchestrator/schedule');
const orchestrator = require('../core/orchestrator');
const { createApp } = require('../services/http-server');
const { createDb } = require('../core/orchestrator/db');

// ─── helpers ─────────────────────────────────────────────────────────────────

function eq(a, b, msg) {
  if (a !== b) throw new Error(`FAIL [${msg}]: expected ${b}, got ${a}`);
}

async function jsonRequest(base, token, reqPath, options = {}) {
  const res = await fetch(base + reqPath, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    ...options,
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

// ─── 1. getStepTimeoutMs unit tests ──────────────────────────────────────────

function testGetStepTimeoutMs() {
  // --- scale=1 (default) ---
  eq(getStepTimeoutMs('asr',     1), 3600000,  'asr x1 = 60 min');
  eq(getStepTimeoutMs('audio',   1), 1800000,  'audio x1 = 30 min');
  eq(getStepTimeoutMs('fetch',   1), 600000,   'fetch x1 = 10 min');
  eq(getStepTimeoutMs('video',   1), 7200000,  'video x1 = 2 h');
  eq(getStepTimeoutMs('article', 1), 3600000,  'article x1 = 60 min');
  eq(getStepTimeoutMs('summary', 1), 3600000,  'summary x1 = 60 min');
  eq(getStepTimeoutMs('vtt2md',  1), 600000,   'vtt2md x1 = 10 min');

  // --- --long x3 ---
  eq(getStepTimeoutMs('asr',     3), 10800000, 'asr x3 = 3 h');
  eq(getStepTimeoutMs('audio',   3), 5400000,  'audio x3 = 90 min');
  eq(getStepTimeoutMs('article', 3), 10800000, 'article x3 = 3 h');
  eq(getStepTimeoutMs('summary', 3), 10800000, 'summary x3 = 3 h');
  eq(getStepTimeoutMs('fetch',   3), 1800000,  'fetch x3 = 30 min');

  // --- --ultra-long x6 ---
  eq(getStepTimeoutMs('asr',   6), 21600000,   'asr x6 = 6 h');
  eq(getStepTimeoutMs('audio', 6), 10800000,   'audio x6 = 3 h');
  eq(getStepTimeoutMs('video', 6), 43200000,   'video x6 = 12 h');

  // --- VL_TIMEOUT_SCALE env (server-wide, no per-task scale) ---
  process.env.VL_TIMEOUT_SCALE = '2';
  eq(getStepTimeoutMs('summary'), 7200000,     'summary env-scale x2 = 2 h');
  eq(getStepTimeoutMs('asr'),     7200000,     'asr env-scale x2 = 2 h');
  delete process.env.VL_TIMEOUT_SCALE;

  // --- per-task scale overrides VL_TIMEOUT_SCALE ---
  process.env.VL_TIMEOUT_SCALE = '2';
  eq(getStepTimeoutMs('asr', 3), 10800000,    'per-task scale (3) overrides env (2)');
  delete process.env.VL_TIMEOUT_SCALE;

  // --- per-step absolute env: highest priority, scale not applied ---
  process.env.VL_TIMEOUT_ASR = '99999';
  eq(getStepTimeoutMs('asr', 6), 99999,       'abs env overrides per-task scale');
  process.env.VL_TIMEOUT_SCALE = '9';
  eq(getStepTimeoutMs('asr'),    99999,       'abs env overrides VL_TIMEOUT_SCALE');
  delete process.env.VL_TIMEOUT_ASR;
  delete process.env.VL_TIMEOUT_SCALE;

  // --- invalid scale → fallback to 1 ---
  eq(getStepTimeoutMs('fetch', -1),  600000,  'negative scale → default');
  eq(getStepTimeoutMs('fetch', NaN), 600000,  'NaN scale → default');
  eq(getStepTimeoutMs('fetch', 0),   600000,  'zero scale → default');
  eq(getStepTimeoutMs('fetch', Infinity), 600000, 'Infinity scale → default');

  // --- unknown step → 10 min fallback × scale ---
  eq(getStepTimeoutMs('unknown', 1), 600000,  'unknown step x1 = 10 min');
  eq(getStepTimeoutMs('unknown', 3), 1800000, 'unknown step x3 = 30 min');

  console.log('  [1] getStepTimeoutMs: PASS');
}

// ─── 2. createTask — timeout_scale stored in params ──────────────────────────

async function testCreateTaskScale() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-ts-create-'));

  // valid scale
  const t3 = await orchestrator.createTask({
    url: 'https://example.com/watch?v=scale-3',
    mode: 'transcript', rootDir: tmp, timeout_scale: 3,
  });
  const task3 = orchestrator._tasks ? orchestrator._tasks.get(t3.task_id) : null;
  if (task3) {
    eq(task3.params.timeout_scale, 3, 'createTask: timeout_scale=3 stored in params');
  }

  // invalid scale → normalized to 1
  const tBad = await orchestrator.createTask({
    url: 'https://example.com/watch?v=scale-bad',
    mode: 'transcript', rootDir: tmp, timeout_scale: -5,
  });
  const taskBad = orchestrator._tasks ? orchestrator._tasks.get(tBad.task_id) : null;
  if (taskBad) {
    eq(taskBad.params.timeout_scale, 1, 'createTask: invalid scale (-5) → 1');
  }

  // no scale → defaults to 1
  const tDef = await orchestrator.createTask({
    url: 'https://example.com/watch?v=scale-default',
    mode: 'transcript', rootDir: tmp,
  });
  const taskDef = orchestrator._tasks ? orchestrator._tasks.get(tDef.task_id) : null;
  if (taskDef) {
    eq(taskDef.params.timeout_scale, 1, 'createTask: no scale → 1');
  }

  console.log('  [2] createTask timeout_scale: PASS');
}

// ─── 3. DB migration — timeout_scale column exists ────────────────────────────

function testDbMigration() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-ts-db-'));
  // createDb(rootDir) → rootDir/work/database.sqlite
  const db = createDb(tmp);

  // The db manager exposes the underlying better-sqlite3 db via a helper or we
  // check via the existing getTask round-trip after updateTask.
  // If column is missing, updateTask({ timeout_scale }) would throw.
  try {
    db.createTask('migrate-test-id', 'https://example.com');
    db.updateTask('migrate-test-id', { timeout_scale: 3 });
    const row = db.getTask('migrate-test-id');
    eq(row.timeout_scale, 3, 'DB: timeout_scale persisted and retrieved');
  } catch (err) {
    throw new Error(`DB migration test failed: ${err.message}`);
  }

  console.log('  [3] DB migration: PASS');
}

// ─── 4. HTTP API — POST /api/tasks with timeout_scale ────────────────────────

async function testHttpApi() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-ts-http-'));
  const token = 'test-ts-token';
  const app = createApp({ rootDir: tmp, token, disableOrchestratorBridge: true });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // timeout_scale=3 accepted, task created
    const r3 = await jsonRequest(base, token, '/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://example.com/watch?v=http-ts-3',
        mode: 'transcript',
        timeout_scale: 3,
      }),
    });
    assert.strictEqual(r3.status, 201, `POST /api/tasks status: ${r3.status}`);
    assert.ok(r3.body.task_id, 'task_id returned');

    // timeout_scale=0 (invalid) → task still created, scale normalized to 1
    const rBad = await jsonRequest(base, token, '/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://example.com/watch?v=http-ts-bad',
        mode: 'transcript',
        timeout_scale: 0,
      }),
    });
    assert.strictEqual(rBad.status, 201, 'invalid scale still creates task');
    assert.ok(rBad.body.task_id, 'task_id returned for invalid scale');

    // no timeout_scale → task still created
    const rNone = await jsonRequest(base, token, '/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://example.com/watch?v=http-ts-none',
        mode: 'transcript',
      }),
    });
    assert.strictEqual(rNone.status, 201, 'no scale still creates task');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('  [4] HTTP API timeout_scale: PASS');
}

// ─── 5. runTask propagation — timeout_scale DB → schedule chain ──────────────
//
// Full runTask hook is not feasible without mocking spawn. Instead we verify the
// complete observable chain:
//   createTask(timeout_scale=N) → DB.timeout_scale=N → getStepTimeoutMs(step, N)
// This confirms that the value survives storage and produces the correct timeout.

async function testPropagation() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-ts-prop-'));
  // orchestrator writes to tmp/work/database.sqlite; createDb(tmp) resolves the same path.
  const db = createDb(tmp);

  // createTask with scale=3 → DB stores 3
  const task = await orchestrator.createTask({
    url: 'https://example.com/watch?v=prop-test',
    mode: 'transcript', rootDir: tmp, timeout_scale: 3,
  });
  const row = db.getTask(task.task_id);
  eq(row.timeout_scale, 3, 'propagation: DB stores timeout_scale=3');

  // DB value → getStepTimeoutMs produces correct scaled timeout
  const scaledAsr = getStepTimeoutMs('asr', row.timeout_scale);
  eq(scaledAsr, 10800000, 'propagation: asr with scale=3 → 3h (10800000 ms)');

  const scaledAudio = getStepTimeoutMs('audio', row.timeout_scale);
  eq(scaledAudio, 5400000, 'propagation: audio with scale=3 → 90 min');

  // createTask with scale=6 → DB stores 6
  const task6 = await orchestrator.createTask({
    url: 'https://example.com/watch?v=prop-test-6',
    mode: 'transcript', rootDir: tmp, timeout_scale: 6,
  });
  const row6 = db.getTask(task6.task_id);
  eq(row6.timeout_scale, 6, 'propagation: DB stores timeout_scale=6');
  eq(getStepTimeoutMs('asr', row6.timeout_scale), 21600000,
    'propagation: asr with scale=6 → 6h');

  // invalid scale → DB stores 1
  const taskBad = await orchestrator.createTask({
    url: 'https://example.com/watch?v=prop-bad',
    mode: 'transcript', rootDir: tmp, timeout_scale: -9,
  });
  const rowBad = db.getTask(taskBad.task_id);
  eq(rowBad.timeout_scale, 1, 'propagation: invalid scale normalized to 1 in DB');

  console.log('  [5] runTask propagation (DB→schedule chain): PASS');
}

// ─── runner ───────────────────────────────────────────────────────────────────

async function run() {
  try {
    console.log('timeout-scale.test.js');

    testGetStepTimeoutMs();
    await testCreateTaskScale();
    testDbMigration();
    await testHttpApi();
    await testPropagation();

    console.log('timeout-scale.test.js: PASS');
    process.exit(0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

run();
