'use strict';

/**
 * 集成测试：runStep 在 spawn 脚本前执行 A 层必需物检查。
 * 不依赖外网；使用独立 URL 生成唯一 task id，结束后 hard delete。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const orchestrator = require('../core/orchestrator');

const ROOT_DIR = path.resolve(__dirname, '..');

async function run() {
  const url = `https://www.youtube.com/watch?v=runstepA${Date.now()}`;
  const { task_id: taskId } = await orchestrator.createTask({
    url,
    focus: '',
    mode: 'transcript',
    force: 0,
    output_lang: 'zh-CN',
    rootDir: ROOT_DIR
  });

  try {
    const subsDir = path.join(ROOT_DIR, 'work', taskId, 'transcript', 'subs');
    assert.ok(fs.existsSync(subsDir), 'subs dir should exist after createTask');

    const r = await orchestrator.runStep(taskId, 'vtt2md', { rootDir: ROOT_DIR });
    assert.strictEqual(r.success, false, 'vtt2md should fail without .vtt');
    assert.ok(
      String(r.error).includes('.vtt') || String(r.error).includes('subs'),
      `expected vtt/subs error, got: ${r.error}`
    );

    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    assert.strictEqual(task.steps.vtt2md.status, 'failed');
    assert.ok(task.steps.vtt2md.error);

    console.log('runstep-a-layer-orchestrator.test.js: PASS');
  } finally {
    orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode: 'hard' });
  }
}

run().catch((e) => {
  console.error('runstep-a-layer-orchestrator.test.js: FAIL', e);
  process.exit(1);
});
