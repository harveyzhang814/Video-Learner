'use strict';
/**
 * Tests DB roundtrip and loadTaskFromDb wiring for opencode_session_id.
 * Creates a task directly in DB (bypassing orchestrator in-memory cache)
 * so getTask triggers loadTaskFromDb, which we verify populates meta.opencode_session_id.
 */

const assert = require('assert');
const path = require('path');
const { createDb } = require('../core/orchestrator/db');
const orchestrator = require('../core/orchestrator');

const ROOT_DIR = path.resolve(__dirname, '..');

async function run() {
  const db = createDb(ROOT_DIR);
  const taskId = `dbtest-session-${Date.now()}`;
  const url = `https://www.youtube.com/watch?v=dbtest${Date.now()}`;

  try {
    // 1. DB column exists: write and read back via raw DB layer
    db.createTask(taskId, url);
    db.updateTask(taskId, { opencode_session_id: 'sess-roundtrip-001', mode: 'full', url });

    const row = db.getTask(taskId);
    assert.ok(row, 'task should exist in DB after createTask');
    assert.strictEqual(row.opencode_session_id, 'sess-roundtrip-001', 'opencode_session_id should roundtrip through DB');

    // 2. loadTaskFromDb populates task.meta.opencode_session_id
    // The task is NOT in orchestrator's in-memory cache (we used createDb directly),
    // so getTask → ensureTask → loadTaskFromDb is triggered.
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    assert.strictEqual(
      task.meta.opencode_session_id,
      'sess-roundtrip-001',
      'loadTaskFromDb must populate meta.opencode_session_id from DB row'
    );

    // 3. Null value roundtrip (simulates abort or step-failure cleanup)
    db.updateTask(taskId, { opencode_session_id: null });
    const row2 = db.getTask(taskId);
    assert.strictEqual(row2.opencode_session_id, null, 'opencode_session_id should persist as null after clear');

    console.log('opencode-session-db: all 3 tests passed');
  } finally {
    try {
      await orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode: 'hard' });
    } catch (_) {}
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
