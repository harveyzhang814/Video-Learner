'use strict';

/**
 * 单元测试：translate 步骤的三个跳过条件。
 * 不依赖外网；每个测试使用独立 URL 生成唯一 task id，结束后 hard delete。
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const orchestrator = require('../core/orchestrator');

// After hard-delete the log WriteStreams may fire an ENOENT when their internal
// close flushes asynchronously. Suppress those benign cleanup errors only.
process.on('uncaughtException', (err) => {
  if (err.code === 'ENOENT' && err.syscall === 'open' && err.path && err.path.includes('/work/')) {
    return; // benign: stream closed after task directory was hard-deleted
  }
  console.error('translate-step.test.js: uncaught exception', err);
  process.exit(1);
});

const ROOT_DIR = path.resolve(__dirname, '..');

async function testSkip1_zhAlreadyExists() {
  // Skip-1: original_zh.md 已存在 → translate 步骤应跳过
  const url = `https://www.youtube.com/watch?v=translateSkip1_${Date.now()}`;
  const { task_id: taskId } = await orchestrator.createTask({
    url,
    focus: '',
    mode: 'transcript',
    force: 0,
    output_lang: 'zh-CN',
    rootDir: ROOT_DIR
  });

  try {
    // 创建 original_zh.md（Skip-1 条件）
    const transcriptDir = path.join(ROOT_DIR, 'work', taskId, 'transcript');
    const zhMd = path.join(transcriptDir, 'original_zh.md');
    fs.writeFileSync(zhMd, '# 已有中文字幕\n');

    const r = await orchestrator.runStep(taskId, 'translate', { rootDir: ROOT_DIR });
    assert.strictEqual(r.success, true, `Skip-1: expected success:true, got: ${JSON.stringify(r)}`);

    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    assert.strictEqual(
      task.steps.translate.status,
      'skipped',
      `Skip-1: expected status 'skipped', got '${task.steps.translate.status}'`
    );

    console.log('translate-step.test.js Skip-1 (zh exists): PASS');
  } finally {
    orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode: 'hard' });
  }
}

async function testSkip2_enMissing() {
  // Skip-2: original_en.md 不存在 → translate 步骤应跳过
  const url = `https://www.youtube.com/watch?v=translateSkip2_${Date.now()}`;
  const { task_id: taskId } = await orchestrator.createTask({
    url,
    focus: '',
    mode: 'transcript',
    force: 0,
    output_lang: 'zh-CN',
    rootDir: ROOT_DIR
  });

  try {
    // 确保 original_en.md 不存在（默认即不存在，但明确确认）
    const transcriptDir = path.join(ROOT_DIR, 'work', taskId, 'transcript');
    const enMd = path.join(transcriptDir, 'original_en.md');
    if (fs.existsSync(enMd)) {
      fs.unlinkSync(enMd);
    }

    const r = await orchestrator.runStep(taskId, 'translate', { rootDir: ROOT_DIR });
    assert.strictEqual(r.success, true, `Skip-2: expected success:true, got: ${JSON.stringify(r)}`);

    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    assert.strictEqual(
      task.steps.translate.status,
      'skipped',
      `Skip-2: expected status 'skipped', got '${task.steps.translate.status}'`
    );

    console.log('translate-step.test.js Skip-2 (en missing): PASS');
  } finally {
    orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode: 'hard' });
  }
}

async function testSkip3_outputLangEn() {
  // Skip-3: output_lang 为 'en'（非 zh 开头）→ translate 步骤应跳过
  const url = `https://www.youtube.com/watch?v=translateSkip3_${Date.now()}`;
  const { task_id: taskId } = await orchestrator.createTask({
    url,
    focus: '',
    mode: 'transcript',
    force: 0,
    output_lang: 'en',
    rootDir: ROOT_DIR
  });

  try {
    const r = await orchestrator.runStep(taskId, 'translate', { rootDir: ROOT_DIR });
    assert.strictEqual(r.success, true, `Skip-3: expected success:true, got: ${JSON.stringify(r)}`);

    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    assert.strictEqual(
      task.steps.translate.status,
      'skipped',
      `Skip-3: expected status 'skipped', got '${task.steps.translate.status}'`
    );

    console.log('translate-step.test.js Skip-3 (output_lang=en): PASS');
  } finally {
    orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode: 'hard' });
  }
}

async function run() {
  await testSkip1_zhAlreadyExists();
  await testSkip2_enMissing();
  await testSkip3_outputLangEn();
  console.log('translate-step.test.js: ALL PASS');
}

run().catch((e) => {
  console.error('translate-step.test.js: FAIL', e);
  process.exit(1);
});
