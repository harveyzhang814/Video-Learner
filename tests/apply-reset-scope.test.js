'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('../core/orchestrator/db');
const orchestrator = require('../core/orchestrator');

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-apply-rscope-'));
  try {
    const { task_id: taskId } = await orchestrator.createTask({
      url: 'https://example.com/watch?v=apply-rscope',
      focus: '',
      mode: 'both',
      force: 0,
      output_lang: 'zh-CN',
      rootDir: tmp
    });
    const id = taskId;

    try {
      orchestrator.applyResetScope(id, 'audio', 'step', { rootDir: tmp });
      assert.fail('expected BAD_ANCHOR_MODE');
    } catch (e) {
      assert.strictEqual(e.code, 'BAD_ANCHOR_MODE');
    }

    orchestrator.skipStep(id, 'video', { rootDir: tmp });
    try {
      orchestrator.applyResetScope(id, 'video', 'step', { rootDir: tmp });
      assert.fail('expected ANCHOR_SKIPPED');
    } catch (e) {
      assert.strictEqual(e.code, 'ANCHOR_SKIPPED');
    }

    const db = createDb(tmp);
    for (const s of orchestrator.STEPS) {
      db.writeStepState(id, s, { status: 'completed', attempts: 1, error: null });
    }
    orchestrator._dropTaskFromMemory(id);
    await orchestrator.getTask(id, { rootDir: tmp });

    const r = orchestrator.applyResetScope(id, 'article', 'downstream', { rootDir: tmp });
    assert.ok(r.reset_steps.includes('article'));
    assert.ok(r.reset_steps.includes('summary'));
    const t = await orchestrator.getTask(id, { rootDir: tmp });
    assert.strictEqual(t.steps.article.status, 'pending');
    assert.strictEqual(t.steps.summary.status, 'pending');
    assert.strictEqual(t.steps.fetch.status, 'completed');

    orchestrator._dropTaskFromMemory(id);
    await orchestrator.getTask(id, { rootDir: tmp });
    orchestrator.applyResetScope(id, 'article', 'step', { rootDir: tmp });
    const t2 = await orchestrator.getTask(id, { rootDir: tmp });
    assert.strictEqual(t2.steps.article.status, 'pending');
    assert.strictEqual(t2.steps.summary.status, 'pending');

    console.log('apply-reset-scope.test.js: PASS');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      // ignore
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
