'use strict';

/**
 * Test hard delete (DB + work dir): must not hit FOREIGN KEY constraint.
 * Uses temp dir and orchestrator directly.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const orchestrator = require('../core/orchestrator');
const { createDb } = require('../core/orchestrator/db');

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-learner-delete-test-'));
  const rootDir = tmpDir;

  console.log('[delete-hard-test] rootDir:', rootDir);

  try {
    const db = createDb(rootDir);
    const taskId = 'test-hard-delete-1';

    db.createTask(taskId, 'https://example.com/v');
    db.updateStep(taskId, 'fetch', 'completed');
    db.updateStep(taskId, 'video', 'pending');
    const stepsBefore = db.getSteps(taskId);
    if (!stepsBefore || stepsBefore.length === 0) {
      throw new Error('expected steps after create/updateStep');
    }
    console.log('[delete-hard-test] task + steps created, steps:', stepsBefore.length);

    orchestrator.deleteTask(taskId, { rootDir, mode: 'hard' });
    console.log('[delete-hard-test] deleteTask(hard) returned');

    const taskAfter = db.getTask(taskId);
    if (taskAfter != null) {
      throw new Error('task should not exist in DB after hard delete, got: ' + JSON.stringify(taskAfter));
    }
    const stepsAfter = db.getSteps(taskId);
    if (stepsAfter.length !== 0) {
      throw new Error('steps should be empty after hard delete, got: ' + stepsAfter.length);
    }
    console.log('[delete-hard-test] task + steps gone from DB, OK');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch (_) {}
  }

  console.log('[delete-hard-test] passed');
}

run().catch((err) => {
  console.error('[delete-hard-test] failed:', err.message);
  process.exit(1);
});
