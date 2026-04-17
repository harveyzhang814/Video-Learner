'use strict';

/**
 * ASR Fallback End-to-End Test
 *
 * 验证路径: fetch → audio → [subs=forced_failed] → asr → vtt2md → article → summary
 *
 * 不依赖"无字幕 URL"：subs=failed 由测试直接注入 DB，asr 随后被 DAG 调度器激活。
 *
 * 运行：
 *   E2E_ASR_ENABLED=1 node tests/asr-fallback-e2e.test.js
 *   E2E_ASR_ENABLED=1 E2E_ASR_URL="https://..." node tests/asr-fallback-e2e.test.js
 *
 * 环境变量：
 *   E2E_ASR_ENABLED      必须设为 1，否则测试跳过（保护 CI）
 *   E2E_ASR_URL          用于下载音频的 YouTube 地址（默认 Rick Roll ~3分30秒）
 *   E2E_ASR_MODEL        mlx_whisper 模型（默认 mlx-community/whisper-large-v3-turbo）
 *   E2E_TIMEOUT_MS       等待单步骤完成的超时（默认 1800000 = 30 分钟）
 *   E2E_POLL_MS          轮询间隔（默认 4000）
 *   E2E_CLEANUP          设为 1 时结束后 hard delete（默认保留产出供人工核验）
 *
 * 前提条件：
 *   - mlx_whisper 已安装（pip install mlx_whisper）
 *   - ffmpeg 在 PATH 中
 *   - 写作引擎可用（WRITING_ENGINE=claude|opencode 及对应 CLI）
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const orchestrator = require('../core/orchestrator');
const { createDb } = require('../core/orchestrator/db');

const ROOT_DIR = path.resolve(__dirname, '..');

const DEFAULT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 4000;
const TRANSCRIPT_MIN_BYTES = 100;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function envBool(name) {
  const v = process.env[name];
  return v === '1' || /^true$/i.test(v || '');
}

function readDefaultEngineFromSettings() {
  const p = path.join(ROOT_DIR, 'scripts', 'settings.conf');
  if (!fs.existsSync(p)) return null;
  try {
    const text = fs.readFileSync(p, 'utf8');
    const m = text.match(/^\s*WRITING_ENGINE_DEFAULT\s*=\s*(\S+)/m);
    return m ? m[1].replace(/['"]/g, '') : null;
  } catch (_) {
    return null;
  }
}

function resolvedWritingEngine() {
  const fromEnv = process.env.WRITING_ENGINE && process.env.WRITING_ENGINE.trim();
  if (fromEnv) return fromEnv;
  const fromSettings = readDefaultEngineFromSettings();
  if (fromSettings) return fromSettings;
  return 'opencode';
}

function precheck() {
  // mlx_whisper
  const r = spawnSync('python3', ['-c', 'import mlx_whisper'], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      'mlx_whisper 未安装。请运行: pip install mlx_whisper\n' +
        (r.stderr || '').trim()
    );
  }

  // ffmpeg
  const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (ff.status !== 0 && ff.error) {
    throw new Error('ffmpeg 未找到，请安装 ffmpeg 并确保在 PATH 中');
  }

  // writing engine
  const engine = (resolvedWritingEngine() || 'opencode').toLowerCase();
  if (engine === 'claude') {
    const c = spawnSync('bash', ['-lc', 'command -v claude >/dev/null 2>&1'], { encoding: 'utf8' });
    if (c.status !== 0) {
      throw new Error('写作引擎为 claude 但未找到 claude CLI');
    }
  } else {
    const op = spawnSync('bash', ['-lc', 'command -v opencode >/dev/null 2>&1'], { encoding: 'utf8' });
    if (op.status !== 0) {
      throw new Error('写作引擎为 opencode 但未找到 opencode CLI');
    }
  }

  console.log('[asr-e2e] precheck OK (mlx_whisper, ffmpeg, writing_engine=' + engine + ')');
}

function printFailureDiagnostics(taskId) {
  const logsDir = path.join(ROOT_DIR, 'work', taskId, 'logs');
  console.error('\n[asr-e2e] --- 失败诊断 ---');
  if (!fs.existsSync(logsDir)) {
    console.error('[asr-e2e] 无 logs 目录');
    return;
  }
  for (const step of ['fetch', 'audio', 'subs', 'asr', 'vtt2md', 'article', 'summary']) {
    const raw = path.join(logsDir, `${step}.raw.log`);
    if (fs.existsSync(raw)) {
      const text = fs.readFileSync(raw, 'utf8');
      const tail = text.split(/\r?\n/).filter(Boolean).slice(-30).join('\n');
      if (tail) console.error(`\n[asr-e2e] --- tail ${step}.raw.log ---\n${tail}`);
    }
  }
}

async function waitForStep(taskId, stepName, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    const s = task.steps[stepName];
    const status = s && s.status;
    if (status === 'completed' || status === 'failed' || status === 'skipped') {
      return { task, status };
    }
    console.log(`[asr-e2e] waiting for ${stepName}: status=${status || 'unknown'}`);
    await sleep(pollMs);
  }
  throw new Error(`waitForStep(${stepName}) timed out after ${timeoutMs}ms`);
}

async function run() {
  if (!envBool('E2E_ASR_ENABLED')) {
    console.log('[asr-e2e] SKIP: set E2E_ASR_ENABLED=1 to run this test (requires mlx_whisper + real audio download)');
    return;
  }

  precheck();

  const testUrl = process.env.E2E_ASR_URL || DEFAULT_URL;
  const asrModel = process.env.E2E_ASR_MODEL || 'mlx-community/whisper-large-v3-turbo';
  const timeoutMs = Number(process.env.E2E_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const pollMs = Number(process.env.E2E_POLL_MS) || DEFAULT_POLL_MS;

  console.log('[asr-e2e] url:', testUrl);
  console.log('[asr-e2e] asr_model:', asrModel);
  console.log('[asr-e2e] timeout_ms:', timeoutMs);

  const { task_id: taskId } = await orchestrator.createTask({
    url: testUrl,
    focus: 'ASR 端到端测试：关键要点',
    mode: 'audio',        // 只需 audio.m4a，最快路径
    force: 1,
    output_lang: 'zh-CN',
    rootDir: ROOT_DIR
  });
  console.log('[asr-e2e] task created:', taskId);

  // Pass ASR_MODEL through environment for asr_transcribe.sh
  process.env.ASR_MODEL = asrModel;

  try {
    // Step 1: fetch
    console.log('[asr-e2e] running fetch...');
    const fetchResult = await orchestrator.runStep(taskId, 'fetch', { rootDir: ROOT_DIR });
    assert.ok(fetchResult.success, `fetch failed: ${fetchResult.error}`);
    console.log('[asr-e2e] fetch: OK');

    // Step 2: audio — downloads audio.m4a (required by asr)
    console.log('[asr-e2e] running audio (downloading audio.m4a — may take a while)...');
    const audioResult = await orchestrator.runStep(taskId, 'audio', { rootDir: ROOT_DIR });
    assert.ok(audioResult.success, `audio failed: ${audioResult.error}`);
    const audioPath = path.join(ROOT_DIR, 'work', taskId, 'media', 'audio.m4a');
    assert.ok(fs.existsSync(audioPath), 'audio.m4a not found after audio step');
    console.log('[asr-e2e] audio: OK — audio.m4a:', fs.statSync(audioPath).size, 'bytes');

    // Inject subs=failed directly into DB (simulates a video with no YouTube subtitles)
    const db = createDb(ROOT_DIR);
    db.updateStep(taskId, 'subs', 'failed', 'no subtitles (injected for ASR e2e test)');
    console.log('[asr-e2e] subs: injected as failed (simulating no-subtitle video)');

    // Step 3: asr — ASR path activated because subs=failed + audio=completed
    console.log('[asr-e2e] running asr (transcribing with mlx_whisper — this is the slowest step)...');
    const asrResult = await orchestrator.runStep(taskId, 'asr', { rootDir: ROOT_DIR });
    if (!asrResult.success) {
      printFailureDiagnostics(taskId);
      assert.fail(`asr step failed: ${asrResult.error}`);
    }

    // Verify VTT file was written
    const subsDir = path.join(ROOT_DIR, 'work', taskId, 'transcript', 'subs');
    const vttFiles = fs.existsSync(subsDir)
      ? fs.readdirSync(subsDir).filter((f) => f.endsWith('.asr.vtt'))
      : [];
    assert.ok(vttFiles.length > 0, 'No .asr.vtt file found in transcript/subs after asr step');
    const vttPath = path.join(subsDir, vttFiles[0]);
    const vttContent = fs.readFileSync(vttPath, 'utf8');
    assert.ok(vttContent.startsWith('WEBVTT'), 'VTT file does not start with WEBVTT header');
    assert.ok(vttContent.length >= TRANSCRIPT_MIN_BYTES, `VTT too short: ${vttContent.length} bytes`);
    assert.ok(/-->/.test(vttContent), 'VTT file has no timestamp lines (-->)');
    console.log('[asr-e2e] asr: OK — wrote', vttFiles[0], `(${vttContent.length} bytes)`);

    // Confirm orchestrator recorded asr=completed
    const taskAfterAsr = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    assert.strictEqual(
      taskAfterAsr.steps.asr && taskAfterAsr.steps.asr.status,
      'completed',
      'orchestrator did not record asr=completed'
    );
    assert.strictEqual(
      taskAfterAsr.steps.subs && taskAfterAsr.steps.subs.status,
      'failed',
      'subs should still be failed'
    );

    // Step 4: vtt2md — downstream step, should be unblocked by asr=completed
    console.log('[asr-e2e] running vtt2md...');
    const vttmdResult = await orchestrator.runStep(taskId, 'vtt2md', { rootDir: ROOT_DIR });
    assert.ok(vttmdResult.success, `vtt2md failed: ${vttmdResult.error}`);
    const origFiles = fs.readdirSync(path.join(ROOT_DIR, 'work', taskId, 'transcript'))
      .filter((f) => f.startsWith('original_') && f.endsWith('.md'));
    assert.ok(origFiles.length > 0, 'No original_*.md after vtt2md');
    console.log('[asr-e2e] vtt2md: OK —', origFiles.join(', '));

    // Step 5: article
    console.log('[asr-e2e] running article...');
    const articleResult = await orchestrator.runStep(taskId, 'article', { rootDir: ROOT_DIR });
    assert.ok(articleResult.success, `article failed: ${articleResult.error}`);
    const articlePath = path.join(ROOT_DIR, 'work', taskId, 'writing', 'article.md');
    assert.ok(fs.existsSync(articlePath), 'writing/article.md not found');
    console.log('[asr-e2e] article: OK —', fs.statSync(articlePath).size, 'bytes');

    // Step 6: summary
    console.log('[asr-e2e] running summary...');
    const summaryResult = await orchestrator.runStep(taskId, 'summary', { rootDir: ROOT_DIR });
    assert.ok(summaryResult.success, `summary failed: ${summaryResult.error}`);
    const summaryPath = path.join(ROOT_DIR, 'work', taskId, 'writing', 'summary.md');
    assert.ok(fs.existsSync(summaryPath), 'writing/summary.md not found');
    console.log('[asr-e2e] summary: OK —', fs.statSync(summaryPath).size, 'bytes');

    // Final assertions: task should not be in a failed state
    const finalTask = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    assert.notStrictEqual(finalTask.status, 'failed',
      `task ended as failed despite asr=completed: ${JSON.stringify(finalTask.steps)}`);

    console.log('\n[asr-e2e] ✓ PASS — ASR fallback path completed successfully');
    console.log('[asr-e2e] subs.status  :', finalTask.steps.subs && finalTask.steps.subs.status);
    console.log('[asr-e2e] asr.status   :', finalTask.steps.asr && finalTask.steps.asr.status);
    console.log('[asr-e2e] vtt2md.status:', finalTask.steps.vtt2md && finalTask.steps.vtt2md.status);
    console.log('[asr-e2e] task.status  :', finalTask.status);
    console.log('[asr-e2e] work dir     :', path.join(ROOT_DIR, 'work', taskId));

    if (envBool('E2E_CLEANUP')) {
      orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode: 'hard' });
      console.log('[asr-e2e] cleaned task (hard delete)');
    } else {
      console.log('[asr-e2e] 保留产出（未设置 E2E_CLEANUP=1）');
    }

  } catch (err) {
    printFailureDiagnostics(taskId);
    throw err;
  }
}

run().catch((err) => {
  console.error('[asr-e2e] FAIL:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
