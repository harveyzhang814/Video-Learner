'use strict';

/**
 * Agent HTTP Service 端到端测试（慢路径 / 需外网与写作引擎）
 *
 * 运行：
 *   npm run test:agent:e2e
 *   E2E_YOUTUBE_URL="https://..." E2E_PIPELINE_MODE=transcript npm run test:agent:e2e
 *
 * 环境变量：
 *   E2E_YOUTUBE_URL       测试用 YouTube 地址（默认 Rick Roll，需有可用字幕）
 *   E2E_PIPELINE_MODE     both | transcript | video | audio（默认 transcript，跳过 video/audio 下载）
 *   E2E_TIMEOUT_MS        等待整条流水线完成的超时（默认 1800000 = 30 分钟）
 *   E2E_POLL_MS           轮询间隔（默认 4000）
 *   E2E_RELAX_CONTENT_ASSERT  设为 1 时仅检查占位符泄露 + 最小长度
 *   E2E_MIN_ARTICLE_CHARS / E2E_MIN_SUMMARY_CHARS  最小字符数阈值
 *   E2E_CLEANUP           设为 1 时在结束时 DELETE task（mode=hard）删除 DB 与 work 目录
 *   E2E_SKIP_ENGINE_CHECK 设为 1 时跳过写作引擎预检（不推荐）
 *
 * 默认保留 work/<id>/ 下产出，便于人工打开 article.md、summary.md 核验。
 *
 * 依赖：仓库根目录下 scripts/、yt-dlp、ffmpeg；WRITING_ENGINE=claude|opencode 及对应 CLI 可用。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const { createApp } = require('../services/http-server');
const { generateId } = require('../core/id');

const ROOT_DIR = path.resolve(__dirname, '..');

const DEFAULT_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 4000;
const DEFAULT_MIN_ARTICLE = 600;
const DEFAULT_MIN_SUMMARY = 300;
const TRANSCRIPT_MIN_BYTES = 200;

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

function normalizeEngine(raw) {
  const e = (raw || 'opencode').toLowerCase();
  if (e === 'claude' || e === 'opencode') return e;
  return 'opencode';
}

function precheckWritingEngine() {
  if (envBool('E2E_SKIP_ENGINE_CHECK')) {
    console.log('[e2e] skipping writing engine check (E2E_SKIP_ENGINE_CHECK=1)');
    return;
  }
  const engine = normalizeEngine(resolvedWritingEngine());
  console.log('[e2e] resolved WRITING_ENGINE for precheck:', engine);

  if (engine === 'claude') {
    const r = spawnSync('bash', ['-lc', 'command -v claude >/dev/null 2>&1'], { encoding: 'utf8' });
    if (r.status !== 0) {
      throw new Error(
        '写作引擎为 claude 但未在 PATH 中找到 claude CLI。请安装 Claude Code 或设置 WRITING_ENGINE=opencode。'
      );
    }
    return;
  }

  const op = spawnSync('bash', ['-lc', 'command -v opencode >/dev/null 2>&1'], { encoding: 'utf8' });
  if (op.status !== 0) {
    throw new Error(
      '写作引擎为 opencode 但未在 PATH 中找到 opencode。请安装 OpenCode CLI 或设置 WRITING_ENGINE=claude。'
    );
  }

  try {
    execFileSync('bash', [path.join(ROOT_DIR, 'scripts', 'opencode_server.sh'), 'ensure'], {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env }
    });
  } catch (e) {
    throw new Error(
      `opencode 服务未能就绪（scripts/opencode_server.sh ensure 失败）。请检查本机 opencode 与网络。详情: ${e.message}`
    );
  }
}

function sha256Utf8(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function readFileSafe(p) {
  return fs.readFileSync(p, 'utf8');
}

function tailLines(filePath, maxLines) {
  if (!fs.existsSync(filePath)) return null;
  const text = readFileSafe(filePath);
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines).join('\n');
}

function tailJsonlErrors(filePath, maxRecords) {
  if (!fs.existsSync(filePath)) return null;
  const lines = readFileSafe(filePath).trim().split(/\r?\n/).filter(Boolean);
  const errors = [];
  for (let i = lines.length - 1; i >= 0 && errors.length < maxRecords; i--) {
    try {
      const o = JSON.parse(lines[i]);
      if (o.level === 'error' || /error|failed/i.test(o.line || '')) errors.unshift(lines[i]);
    } catch (_) {
      /* ignore */
    }
  }
  return errors.length ? errors.join('\n') : null;
}

const PLACEHOLDER_PATTERNS = [
  /\{\{FOCUS\}\}/,
  /\{\{ARTICLE_PATH\}\}/,
  /\{\{ORIGINAL_PATH\}\}/,
  /\{\{SOURCE_LANG\}\}/
];

function assertNoPromptLeak(text, label) {
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(text)) {
      throw new Error(`${label} 仍含未替换模板占位符（${re}），疑似将 prompt 写入产出文件`);
    }
  }
}

function assertArticleShape(text, relaxed) {
  assertNoPromptLeak(text, 'article.md');
  const minChars = Number(process.env.E2E_MIN_ARTICLE_CHARS) || DEFAULT_MIN_ARTICLE;
  if (text.length < minChars) {
    throw new Error(`article.md 过短 (${text.length} < ${minChars})，可能生成失败`);
  }
  if (!/^#\s/m.test(text) && !/^#\s/.test(text.trim())) {
    throw new Error('article.md 缺少 Markdown 一级标题 (# ...)');
  }
  if (!relaxed && !/\[\d{1,3}:\d{2}\]/.test(text)) {
    throw new Error('article.md 未检测到 [mm:ss] 时间戳，不符合 article 提示词约束');
  }
}

function assertSummaryShape(text, relaxed) {
  assertNoPromptLeak(text, 'summary.md');
  const minChars = Number(process.env.E2E_MIN_SUMMARY_CHARS) || DEFAULT_MIN_SUMMARY;
  if (text.length < minChars) {
    throw new Error(`summary.md 过短 (${text.length} < ${minChars})，可能生成失败`);
  }
  if (!/#/.test(text)) {
    throw new Error('summary.md 缺少标题（#）');
  }
  if (!relaxed) {
    const hasSection =
      /TL;DR|概要|总结|要点|核心观点|主要论点|Outline|Key\s*Points|摘要正文/i.test(text);
    if (!hasSection) {
      throw new Error(
        'summary.md 未检测到常见摘要结构关键词（如 TL;DR、核心观点、主要论点、Outline 等）'
      );
    }
  }
}

function printFailureDiagnostics(workId) {
  const base = path.join(ROOT_DIR, 'work', workId);
  const logsDir = path.join(base, 'logs');
  console.error('\n[e2e] --- 失败诊断 ---');
  console.error('[e2e] work dir:', base);

  if (!fs.existsSync(logsDir)) {
    console.error('[e2e] 无 logs 目录');
    return;
  }

  const steps = ['fetch', 'video', 'audio', 'subs', 'vtt2md', 'md2vtt', 'article', 'summary'];
  for (const s of steps) {
    const raw = path.join(logsDir, `${s}.raw.log`);
    if (fs.existsSync(raw)) {
      const tail = tailLines(raw, 40);
      if (tail) {
        console.error(`\n[e2e] --- tail ${s}.raw.log ---\n${tail}`);
      }
    }
  }

  const jsonl = path.join(logsDir, 'task.log.jsonl');
  const errSummary = tailJsonlErrors(jsonl, 25);
  if (errSummary) {
    console.error(`\n[e2e] --- task.log.jsonl error-like ---\n${errSummary}`);
  }
}

function printFailedSteps(taskBody) {
  const steps = taskBody.steps;
  if (!steps || typeof steps !== 'object') return;
  for (const [name, info] of Object.entries(steps)) {
    if (info && info.status === 'failed') {
      console.error(`[e2e] step failed: ${name}: ${info.error || '(no error message)'}`);
    }
  }
}

async function run() {
  precheckWritingEngine();

  const testUrl = process.env.E2E_YOUTUBE_URL || DEFAULT_URL;
  const mode = process.env.E2E_PIPELINE_MODE || 'transcript';
  const timeoutMs = Number(process.env.E2E_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const pollMs = Number(process.env.E2E_POLL_MS) || DEFAULT_POLL_MS;
  const relaxed = envBool('E2E_RELAX_CONTENT_ASSERT');
  const expectedId = generateId(testUrl);

  const app = createApp({ rootDir: ROOT_DIR });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  console.log('[e2e] server:', base);
  console.log('[e2e] ROOT_DIR:', ROOT_DIR);
  console.log('[e2e] url:', testUrl, 'mode:', mode, 'expected id:', expectedId);
  console.log('[e2e] timeout_ms:', timeoutMs, 'poll_ms:', pollMs);

  async function jsonRequest(pathname, options = {}) {
    const res = await fetch(base + pathname, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid JSON from ${pathname}: ${text.slice(0, 400)}`);
      }
    }
    return { status: res.status, body };
  }

  const createRes = await jsonRequest('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      url: testUrl,
      focus: '端到端测试：结构与关键信息',
      mode,
      force: 1,
      output_lang: 'zh-CN'
    })
  });

  if (createRes.status !== 201 || !createRes.body || !createRes.body.task_id) {
    console.error('[e2e] create failed:', createRes);
    throw new Error('POST /api/tasks 未返回 201 或缺少 task_id');
  }

  const taskId = createRes.body.task_id;
  if (taskId !== expectedId) {
    console.warn('[e2e] warning: task_id !== generateId(url)', taskId, expectedId);
  }

  const started = Date.now();
  let lastBody = null;

  while (Date.now() - started < timeoutMs) {
    await sleep(pollMs);
    const statusRes = await jsonRequest(`/api/tasks/${taskId}`);
    if (statusRes.status !== 200) {
      throw new Error(`GET /api/tasks/${taskId} 返回 ${statusRes.status}`);
    }
    lastBody = statusRes.body;
    const st = lastBody.status;
    console.log('[e2e] poll status=', st, 'elapsed_s=', Math.round((Date.now() - started) / 1000));
    if (st === 'completed' || st === 'failed') break;
  }

  if (!lastBody || (lastBody.status !== 'completed' && lastBody.status !== 'failed')) {
    throw new Error(`等待流水线超时（${timeoutMs}ms），最后状态: ${lastBody && lastBody.status}`);
  }

  if (lastBody.status === 'failed') {
    console.error('[e2e] task status: failed');
    printFailedSteps(lastBody);
    printFailureDiagnostics(taskId);
    throw new Error('流水线失败，见上方步骤错误与日志摘要');
  }

  const workBase = path.join(ROOT_DIR, 'work', taskId);
  const metaPath = path.join(workBase, 'transcript', 'meta.json');
  const writingDir = path.join(workBase, 'writing');
  const articlePath = path.join(writingDir, 'article.md');
  const summaryPath = path.join(writingDir, 'summary.md');
  const origEn = path.join(workBase, 'transcript', 'original_en.md');
  const origZh = path.join(workBase, 'transcript', 'original_zh.md');

  // HTTP 编排路径将 meta 存在 SQLite / GET task 的 meta 中，未必落盘 transcript/meta.json（CLI run.sh 才可能写文件）
  const m = lastBody.meta || {};
  if (!m.transcript_done || !m.article_done || !m.summary_done) {
    printFailureDiagnostics(taskId);
    throw new Error(
      `任务 meta 未标记完成: transcript_done=${m.transcript_done} article_done=${m.article_done} summary_done=${m.summary_done}`
    );
  }
  if (fs.existsSync(metaPath)) {
    console.log('[e2e] 发现 transcript/meta.json（可选 CLI 产物）');
  }

  const hasOrig =
    (fs.existsSync(origEn) && fs.statSync(origEn).size >= TRANSCRIPT_MIN_BYTES) ||
    (fs.existsSync(origZh) && fs.statSync(origZh).size >= TRANSCRIPT_MIN_BYTES);
  if (!hasOrig) {
    printFailureDiagnostics(taskId);
    throw new Error('缺少足够大的 original_en.md 或 original_zh.md');
  }

  if (!fs.existsSync(articlePath) || !fs.existsSync(summaryPath)) {
    printFailureDiagnostics(taskId);
    throw new Error('缺少 writing/article.md 或 writing/summary.md');
  }

  const articleText = readFileSafe(articlePath);
  const summaryText = readFileSafe(summaryPath);
  assertArticleShape(articleText, relaxed);
  assertSummaryShape(summaryText, relaxed);

  console.log('[e2e] 首轮产出校验通过');
  console.log('[e2e] 人工核验目录:', workBase);

  const summaryStatBefore = fs.statSync(summaryPath);
  const hashBefore = sha256Utf8(summaryText);

  const stepsBefore = await jsonRequest(`/api/tasks/${taskId}/steps`);
  const summaryStepBefore = Array.isArray(stepsBefore.body)
    ? stepsBefore.body.find((s) => s.name === 'summary')
    : null;
  const attemptsBefore = summaryStepBefore ? summaryStepBefore.attempts : 0;

  const rerun = await jsonRequest(`/api/tasks/${taskId}/steps/summary/run`, {
    method: 'POST',
    body: JSON.stringify({
      focus: '端到端重跑：只提取行动项与可执行建议，忽略背景叙述',
      force: true
    })
  });

  if (rerun.status !== 202 || !rerun.body || !rerun.body.success) {
    console.error('[e2e] summary rerun response:', rerun);
    printFailureDiagnostics(taskId);
    throw new Error(`重跑 summary 失败: HTTP ${rerun.status} body=${JSON.stringify(rerun.body)}`);
  }

  const summaryStatAfter = fs.statSync(summaryPath);
  const hashAfter = sha256Utf8(readFileSafe(summaryPath));
  const stepsAfter = await jsonRequest(`/api/tasks/${taskId}/steps`);
  const summaryStepAfter = Array.isArray(stepsAfter.body)
    ? stepsAfter.body.find((s) => s.name === 'summary')
    : null;
  const attemptsAfter = summaryStepAfter ? summaryStepAfter.attempts : 0;

  const mtimeOk = summaryStatAfter.mtimeMs >= summaryStatBefore.mtimeMs;
  const hashOk = hashAfter !== hashBefore;
  const attemptsOk = attemptsAfter > attemptsBefore;

  if (!hashOk && !mtimeOk && !attemptsOk) {
    printFailureDiagnostics(taskId);
    throw new Error(
      '重跑 summary 后未观察到文件更新（mtime/hash）且 attempts 未增加；请检查 runStep 是否写回同一 summary.md'
    );
  }

  assertSummaryShape(readFileSafe(summaryPath), relaxed);
  console.log('[e2e] 重跑 summary 后校验通过 (hash_changed=', hashOk, 'mtime_ok=', mtimeOk, 'attempts=', attemptsAfter, ')');

  if (envBool('E2E_CLEANUP')) {
    const del = await fetch(`${base}/api/tasks/${taskId}?mode=hard`, { method: 'DELETE' });
    if (del.status !== 204 && del.status !== 200) {
      const t = await del.text();
      throw new Error(`E2E_CLEANUP: DELETE failed ${del.status} ${t}`);
    }
    console.log('[e2e] cleaned task (hard delete)');
  } else {
    console.log('[e2e] 保留产出与 DB（未设置 E2E_CLEANUP=1）');
  }

  server.close();
  console.log('[e2e] agent-service-e2e.test.js 完成');
}

run().catch((err) => {
  console.error('[e2e] failed:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
