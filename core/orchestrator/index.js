'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { generateId } = require('../id');
const { createDb } = require('./db');

// In-memory task store (also persisted to SQLite via ensureDb).
const tasks = new Map();
const dbCache = new Map();

// Minimal event bus for external consumers (HTTP SSE, etc.)
const orchestratorEvents = new EventEmitter();
orchestratorEvents.setMaxListeners(0);
let globalEventSeq = 1;

// Per (taskId, stepName) download progress state for yt-dlp video/audio steps.
// Map key: `${taskId}:${stepName}` -> { lastSentAt: number, lastSentPercent: number|null }
const downloadProgressState = new Map();

function emitOrchestratorEvent(type, taskId, payload = {}) {
  const ev = {
    eventId: String(globalEventSeq++),
    type,
    taskId: taskId || null,
    ts: new Date().toISOString(),
    payload
  };
  orchestratorEvents.emit('event', ev);
  return ev;
}

function makeDownloadProgressKey(taskId, stepName) {
  return `${taskId || ''}:${stepName || ''}`;
}

function resetDownloadProgressState(taskId, stepName) {
  const key = makeDownloadProgressKey(taskId, stepName);
  downloadProgressState.set(key, { lastSentAt: 0, lastSentPercent: null });
}

function getDownloadProgressState(taskId, stepName) {
  const key = makeDownloadProgressKey(taskId, stepName);
  if (!downloadProgressState.has(key)) {
    downloadProgressState.set(key, { lastSentAt: 0, lastSentPercent: null });
  }
  return downloadProgressState.get(key);
}

function parseYtDlpProgressLine(line) {
  if (!line) return null;
  const m = line.match(/^\[progress\]\s+downloaded=(\d+)\s+total=(\d+)\s+speed=([\d.]+)\s+eta=(\d+)/);
  if (!m) return null;
  const downloaded = Number(m[1]);
  const total = Number(m[2]);
  const speed = Number(m[3]);
  const eta = Number(m[4]);
  if (!Number.isFinite(downloaded) || downloaded < 0) return null;
  if (!Number.isFinite(total) || total < 0) return null;
  return { downloaded, total, speed: Number.isFinite(speed) ? speed : 0, eta: Number.isFinite(eta) ? eta : 0 };
}

function formatBytesToHuman(bytes) {
  const b = typeof bytes === 'number' && bytes >= 0 ? bytes : 0;
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (b < KB) return `${b} B`;
  if (b < MB) return `${(b / KB).toFixed(1)} KiB`;
  if (b < GB) return `${(b / MB).toFixed(1)} MiB`;
  return `${(b / GB).toFixed(1)} GiB`;
}

function formatEta(etaSecs) {
  const s = typeof etaSecs === 'number' && etaSecs > 0 ? Math.floor(etaSecs) : 0;
  if (s <= 0) return null;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDownloadProgressLog(kind, info) {
  const { downloaded, total, speed, eta, percent } = info;
  const humanDownloaded = formatBytesToHuman(downloaded);
  const humanTotal = total > 0 ? formatBytesToHuman(total) : null;
  const humanSpeed = speed > 0 ? `${formatBytesToHuman(speed)}/s` : null;
  const humanEta = formatEta(eta);

  if (total > 0 && typeof percent === 'number') {
    const parts = [];
    parts.push(`${humanDownloaded} / ${humanTotal}`);
    if (humanSpeed) parts.push(humanSpeed);
    if (humanEta) parts.push(`eta ${humanEta}`);
    return `[${kind}] progress: ${percent}% (${parts.join(', ')})`;
  }

  const parts = [];
  parts.push(humanDownloaded);
  if (humanSpeed) parts.push(humanSpeed);
  parts.push('total size unknown');
  return `[${kind}] progress: downloaded ${parts.join(', ')}`;
}

function onEvent(handler) {
  orchestratorEvents.on('event', handler);
  return () => orchestratorEvents.off('event', handler);
}

function ensureDb(rootDir) {
  if (!dbCache.has(rootDir)) {
    dbCache.set(rootDir, createDb(rootDir));
  }
  return dbCache.get(rootDir);
}

function listTasks(options = {}) {
  const rootDir = options.rootDir ?? path.resolve(__dirname, '../..');
  const db = ensureDb(rootDir);
  const limit = options.limit ?? 200;
  return db.listTasks({ limit });
}

// Step definitions (aligned with scripts/*)
const STEPS = ['fetch', 'video', 'audio', 'subs', 'vtt2md', 'md2vtt', 'article', 'summary'];

const STEP_SCRIPTS = {
  fetch: 'fetch_info.sh',
  video: 'download_video.sh',
  audio: 'download_audio.sh',
  subs: 'download_subs.sh',
  vtt2md: 'convert_vtt_md.sh',
  md2vtt: 'convert_md_vtt.sh',
  article: 'generate_article.sh',
  summary: 'generate_summary.sh'
};

function getWorkDir(rootDir, id) {
  return path.join(rootDir, 'work', id);
}

/**
 * Append a simple JSONL entry to work/index.jsonl for traceability.
 */
function appendIndex(rootDir, record) {
  const indexPath = path.join(rootDir, 'work', 'index.jsonl');
  const line = JSON.stringify(record) + '\n';
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.appendFileSync(indexPath, line, 'utf8');
}

function ensureWorkSubdirs(rootDir, id) {
  const dir = getWorkDir(rootDir, id);
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'transcript', 'subs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'writing'), { recursive: true });
}

function initSteps() {
  const steps = {};
  for (const name of STEPS) {
    steps[name] = { status: 'pending', attempts: 0, error: null };
  }
  return steps;
}

/**
 * Load task from SQLite into memory (for restart recovery). Returns task or null.
 */
function loadTaskFromDb(taskId, rootDir) {
  const db = ensureDb(rootDir);
  const row = db.getTask(taskId);
  if (!row) return null;

  const stepsRows = db.getSteps(taskId);
  const steps = initSteps();
  for (const r of stepsRows) {
    if (STEPS.includes(r.step_name)) {
      steps[r.step_name] = {
        status: r.status || 'pending',
        attempts: r.attempts || 0,
        error: r.error || null
      };
    }
  }

  const statusList = Object.values(steps).map((s) => s.status);
  let status = 'pending';
  if (statusList.some((s) => s === 'running')) status = 'running';
  else if (statusList.some((s) => s === 'failed')) status = 'failed';
  else if (statusList.every((s) => s === 'completed' || s === 'skipped')) status = 'completed';

  const task = {
    task_id: taskId,
    status,
    created_at: row.created_at || row.ts,
    updated_at: row.updated_at || row.ts,
    params: {
      url: row.url,
      focus: row.focus || '',
      mode: 'both',
      force: 0,
      output_lang: row.output_lang || 'zh-CN',
      rootDir
    },
    meta: {
      url: row.url,
      id: taskId,
      ts: row.ts || row.created_at,
      title: row.title || '',
      duration: row.duration != null ? String(row.duration) : '',
      lang: row.lang || '',
      output_lang: row.output_lang || 'zh-CN',
      focus: row.focus || '',
      download_status: 'pending',
      transcript_done: false,
      article_done: false,
      summary_done: false
    },
    steps,
    processInfo: null
  };
  tasks.set(taskId, task);
  updateTaskMetaFromFilesystem(task);
  return task;
}

/**
 * Ensure task is in memory; load from DB if needed (options.rootDir required for restore).
 */
function ensureTask(taskId, options = {}) {
  let task = tasks.get(taskId);
  if (!task && options.rootDir) {
    task = loadTaskFromDb(taskId, options.rootDir);
  }
  if (!task) {
    throw new Error(`task not found: ${taskId}`);
  }
  return task;
}

/**
 * Create a logical task but do not start execution yet.
 * params: { url, focus, mode, force, output_lang, rootDir }
 */
async function createTask(params) {
  const { url, focus = '', mode = 'both', force = 0, output_lang = 'zh-CN', rootDir } = params;
  if (!url) {
    throw new Error('url is required');
  }
  if (!rootDir) {
    throw new Error('rootDir is required');
  }

  const id = generateId(url);
  const taskId = id; // For MVP we just use id as taskId
  const now = new Date().toISOString();
  const workDir = getWorkDir(rootDir, id);

  fs.mkdirSync(workDir, { recursive: true });
  ensureWorkSubdirs(rootDir, id);

  const meta = {
    url,
    id,
    ts: now,
    output_lang,
    focus,
    mode,
    download_status: 'pending',
    transcript_done: false,
    article_done: false,
    summary_done: false
  };

  const task = {
    task_id: taskId,
    status: 'pending',
    created_at: now,
    updated_at: now,
    params: { url, focus, mode, force, output_lang, rootDir },
    meta,
    steps: initSteps(),
    processInfo: null
  };

  tasks.set(taskId, task);

  const db = ensureDb(rootDir);
  db.createTask(id, url);
  db.updateTask(id, { url, title: '', focus, output_lang });
  for (const step of STEPS) {
    db.updateStep(id, step, 'pending');
  }

  appendIndex(rootDir, {
    task_id: taskId,
    ...meta,
    status: task.status
  });

  emitOrchestratorEvent('task.created', taskId, { meta: task.meta, status: task.status });
  return { task_id: taskId, status: task.status, meta: task.meta };
}

function updateTaskMetaFromFilesystem(task) {
  const { url, id, output_lang, focus, mode } = task.meta;
  const rootDir = task.params.rootDir;
  const baseDir = getWorkDir(rootDir, id);
  const transcriptDir = path.join(baseDir, 'transcript');
  const writingDir = path.join(baseDir, 'writing');
  const mediaDir = path.join(baseDir, 'media');

  const meta = {
    url,
    id,
    ts: task.meta.ts,
    output_lang,
    focus,
    mode,
    download_status: task.meta.download_status,
    transcript_done: task.meta.transcript_done,
    article_done: task.meta.article_done,
    summary_done: task.meta.summary_done
  };

  if (fs.existsSync(mediaDir)) {
    const videoPath = path.join(mediaDir, 'video.mp4');
    if (fs.existsSync(videoPath)) {
      meta.download_status = 'success';
    }
  }

  if (fs.existsSync(transcriptDir)) {
    const originalEn = path.join(transcriptDir, 'original_en.md');
    const originalZh = path.join(transcriptDir, 'original_zh.md');
    if (fs.existsSync(originalEn) || fs.existsSync(originalZh)) {
      meta.transcript_done = true;
    }
  }

  if (fs.existsSync(writingDir)) {
    const articlePath = path.join(writingDir, 'article.md');
    const summaryPath = path.join(writingDir, 'summary.md');
    if (fs.existsSync(articlePath)) {
      meta.article_done = true;
    }
    if (fs.existsSync(summaryPath)) {
      meta.summary_done = true;
    }
  }

  task.meta = meta;
}

/**
 * Build a user-facing error message from script exit code and output.
 * Avoids showing [STATUS] lines as the error; prefers lines that look like real errors.
 */
function formatStepError(code, output) {
  const raw = (output || '').trim();
  if (!raw) return `Step failed (exit code ${code}). See log for details.`;
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const nonStatus = lines.filter((l) => !/^\[STATUS\]\s/.test(l.trim()));
  const errorLike = nonStatus.filter((l) => /error|failed|Error|Failed/i.test(l));
  const msg = (errorLike.length ? errorLike[errorLike.length - 1] : nonStatus[nonStatus.length - 1] || lines[lines.length - 1]).trim();
  if (!msg || /^\[STATUS\]/.test(msg)) return `Step failed (exit code ${code}). See log for details.`;
  return msg;
}

/**
 * Build env for child process so yt-dlp/ffmpeg are found when run from Electron (no full shell PATH).
 */
function spawnEnv() {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
  const pathList = [process.env.PATH, ...extra].filter(Boolean);
  const PATH = [...new Set(pathList.join(':').split(':'))].filter(Boolean).join(':');
  return { ...process.env, PATH };
}

/**
 * Low-level helper to run a single step script and collect its exit code/output.
 * opts.onOutput(text) optional - called for each stdout/stderr chunk (e.g. for Electron log stream).
 */
function runStepScript(rootDir, stepName, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join(rootDir, 'scripts', STEP_SCRIPTS[stepName]);
    const proc = spawn('bash', [script, ...args], { cwd: rootDir, env: spawnEnv() });

    let output = '';
    const onChunk = (data) => {
      const text = data.toString();
      output += text;
      if (opts.onOutput) opts.onOutput(text);
    };
    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk);

    proc.on('close', (code) => {
      resolve({ code, output });
    });
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Run a single logical step and update in-memory step status.
 * options: { focus, force }
 */
async function runStep(taskId, stepName, options = {}) {
  const task = ensureTask(taskId, options);
  if (!STEPS.includes(stepName)) {
    throw new Error(`unknown step: ${stepName}`);
  }

  const { focus = '', force = false } = options;
  const { rootDir, mode } = task.params;
  const id = task.meta.id;
  const dir = getWorkDir(rootDir, id);

  task.steps = task.steps || initSteps();
  const stepState = task.steps[stepName] || { status: 'pending', attempts: 0, error: null };

  const db = ensureDb(rootDir);

  // Simple mode-based skipping for media steps
  if (stepName === 'video' && mode === 'audio') {
    stepState.status = 'skipped';
    task.steps[stepName] = stepState;
    db.updateStep(id, stepName, 'skipped');
    return { success: true, skipped: true };
  }
  if (stepName === 'audio' && mode === 'video') {
    stepState.status = 'skipped';
    task.steps[stepName] = stepState;
    db.updateStep(id, stepName, 'skipped');
    return { success: true, skipped: true };
  }

  stepState.status = 'running';
  stepState.attempts += 1;
  stepState.error = null;
  task.steps[stepName] = stepState;
  task.updated_at = new Date().toISOString();
  db.updateStep(id, stepName, 'running');
  // Reset per-step download progress state for media steps so each run starts fresh.
  if (stepName === 'video' || stepName === 'audio') {
    resetDownloadProgressState(taskId, stepName);
  }
  emitOrchestratorEvent('step.started', taskId, { stepName, attempts: stepState.attempts });
  emitOrchestratorEvent('task.updated', taskId, { status: task.status, stepName, stepStatus: 'running' });

  const url = task.meta.url;
  const enMd = path.join(dir, 'transcript', 'original_en.md');
  const zhMd = path.join(dir, 'transcript', 'original_zh.md');

  let args = [];

  switch (stepName) {
    case 'fetch':
      args = [url, dir, id];
      break;
    case 'video':
      args = [url, dir, id, force ? '1' : '0'];
      break;
    case 'audio':
      args = [url, dir, id, force ? '1' : '0'];
      break;
    case 'subs':
      args = [url, dir, id];
      break;
    case 'vtt2md': {
      const subsDir = path.join(dir, 'transcript', 'subs');
      const vttFiles = fs.existsSync(subsDir)
        ? fs.readdirSync(subsDir).filter((f) => f.endsWith('.vtt'))
        : [];
      const errors = [];
      for (const vtt of vttFiles) {
        try {
          const match = vtt.match(/\.([^.]+)\./);
          const lang = match && match[1] ? match[1] : 'en';
          const outPath = path.join(dir, 'transcript', `original_${lang}.md`);
          const result = await runStepScript(rootDir, 'vtt2md', [path.join(subsDir, vtt), outPath], { onOutput: options.onOutput });
          if (result.code !== 0) {
            errors.push(`${vtt}: ${result.output || 'failed'}`);
          }
        } catch (e) {
          errors.push(`${vtt}: ${e.message}`);
        }
      }
      if (errors.length > 0) {
        stepState.status = 'failed';
        stepState.error = errors.join('\n');
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'failed', stepState.error);
        return { success: false, error: stepState.error };
      }
      stepState.status = 'completed';
      task.steps[stepName] = stepState;
      db.updateStep(id, stepName, 'completed');
      updateTaskMetaFromFilesystem(task);
      return { success: true };
    }
    case 'md2vtt': {
      const errors = [];
      if (fs.existsSync(enMd)) {
        try {
          const result = await runStepScript(rootDir, 'md2vtt', [enMd, enMd.replace('.md', '.vtt')], { onOutput: options.onOutput });
          if (result.code !== 0) {
            errors.push(`original_en.md: ${result.output || 'failed'}`);
          }
        } catch (e) {
          errors.push(`original_en.md: ${e.message}`);
        }
      }
      if (fs.existsSync(zhMd)) {
        try {
          const result = await runStepScript(rootDir, 'md2vtt', [zhMd, zhMd.replace('.md', '.vtt')], { onOutput: options.onOutput });
          if (result.code !== 0) {
            errors.push(`original_zh.md: ${result.output || 'failed'}`);
          }
        } catch (e) {
          errors.push(`original_zh.md: ${e.message}`);
        }
      }
      if (errors.length > 0) {
        stepState.status = 'failed';
        stepState.error = errors.join('\n');
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'failed', stepState.error);
        return { success: false, error: stepState.error };
      }
      stepState.status = 'completed';
      task.steps[stepName] = stepState;
      db.updateStep(id, stepName, 'completed');
      updateTaskMetaFromFilesystem(task);
      return { success: true };
    }
    case 'article': {
      const transcriptPath = fs.existsSync(enMd)
        ? enMd
        : fs.existsSync(zhMd)
        ? zhMd
        : null;
      if (!transcriptPath) {
        stepState.status = 'failed';
        stepState.error = 'No transcript file found';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'failed', stepState.error);
        return { success: false, error: stepState.error };
      }
      const outPath = path.join(dir, 'writing', 'article.md');
      args = [transcriptPath, outPath, task.meta.output_lang || 'zh-CN'];
      break;
    }
    case 'summary': {
      const articlePath = path.join(dir, 'writing', 'article.md');
      if (!fs.existsSync(articlePath)) {
        stepState.status = 'failed';
        stepState.error = 'article.md not found';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'failed', stepState.error);
        return { success: false, error: stepState.error };
      }
      const summaryFocus = focus || task.meta.focus || '视频的主要内容和要点';
      const outPath = path.join(dir, 'writing', 'summary.md');
      args = [articlePath, summaryFocus, outPath, task.meta.output_lang || 'zh-CN'];
      break;
    }
    default:
      break;
  }

  if (args.length > 0) {
    const baseOnOutput = options.onOutput;
    let onOutput = baseOnOutput;
    if (stepName === 'video' || stepName === 'audio') {
      const kind = stepName === 'video' ? 'video' : 'audio';
      onOutput = (textChunk) => {
        if (baseOnOutput) baseOnOutput(textChunk);
        const str = String(textChunk || '');
        const lines = str.split(/\r?\n/);
        for (const line of lines) {
          const parsed = parseYtDlpProgressLine(line.trim());
          if (!parsed) continue;
          const { downloaded, total, speed, eta } = parsed;
          const state = getDownloadProgressState(taskId, stepName);
          const now = Date.now();
          const deltaMs = now - (state.lastSentAt || 0);
          let percent = null;
          if (total > 0) {
            const raw = (downloaded / total) * 100;
            if (Number.isFinite(raw)) {
              percent = Math.max(0, Math.min(100, Math.round(raw)));
            }
          }
          let shouldSend = false;
          if (percent != null) {
            if (state.lastSentPercent == null) {
              shouldSend = true;
            } else if (deltaMs >= 1000 || Math.abs(percent - state.lastSentPercent) >= 1) {
              shouldSend = true;
            }
          } else if (deltaMs >= 1000) {
            shouldSend = true;
          }
          if (!shouldSend) continue;
          const lineText = formatDownloadProgressLog(kind, { downloaded, total, speed, eta, percent });
          emitOrchestratorEvent('log.appended', taskId, {
            line: lineText,
            level: 'info'
          });
          state.lastSentAt = now;
          state.lastSentPercent = percent;
        }
      };
    }

    const result = await runStepScript(rootDir, stepName, args, { onOutput });
    if (result.code === 0) {
      stepState.status = 'completed';
      stepState.error = null;
    } else {
      stepState.status = 'failed';
      stepState.error = formatStepError(result.code, result.output);
    }
    task.steps[stepName] = stepState;
    db.updateStep(id, stepName, stepState.status, stepState.error || null);
  }

  updateTaskMetaFromFilesystem(task);

  emitOrchestratorEvent('step.finished', taskId, {
    stepName,
    status: task.steps[stepName].status,
    error: task.steps[stepName].error || null
  });
  emitOrchestratorEvent('task.updated', taskId, {
    status: task.status,
    stepName,
    stepStatus: task.steps[stepName].status
  });
  return { success: task.steps[stepName].status === 'completed', error: task.steps[stepName].error || null };
}

/**
 * Run the full pipeline by orchestrating individual steps.
 * This is synchronous from the caller's perspective (returns when finished).
 */
async function runTask(taskId, options = {}) {
  const task = ensureTask(taskId, options);
  if (task.status === 'running') {
    return; // already running
  }

  task.status = 'running';
  task.updated_at = new Date().toISOString();
  emitOrchestratorEvent('task.updated', taskId, { status: task.status });

  const { mode, focus } = task.params;

  // Step 0: fetch
  await runStep(taskId, 'fetch');

  // Media download based on mode
  if (mode === 'both' || mode === 'video') {
    await runStep(taskId, 'video', { force: task.params.force });
  } else if (mode === 'audio') {
    await runStep(taskId, 'audio', { force: task.params.force });
  }

  // Transcript-related steps
  await runStep(taskId, 'subs');
  await runStep(taskId, 'vtt2md');
  await runStep(taskId, 'md2vtt');
  await runStep(taskId, 'article');
  await runStep(taskId, 'summary', { focus });

  updateTaskMetaFromFilesystem(task);

  // Mark overall task status based on last step
  const failedStep = Object.values(task.steps || {}).find((s) => s.status === 'failed');
  task.status = failedStep ? 'failed' : 'completed';
  task.updated_at = new Date().toISOString();
  emitOrchestratorEvent('task.updated', taskId, { status: task.status });
}

async function getTask(taskId, options = {}) {
  const task = ensureTask(taskId, options);
  const rootDir = task.params && task.params.rootDir;
  if (rootDir) {
    const db = ensureDb(rootDir);
    const row = db.getTask(task.meta.id);
    if (row) {
      if (row.title != null && row.title !== '') task.meta.title = row.title;
      if (row.duration != null && row.duration !== '') task.meta.duration = row.duration;
      if (row.lang != null && row.lang !== '') task.meta.lang = row.lang;
    }
  }
  if (task.status === 'completed' || task.status === 'failed') {
    updateTaskMetaFromFilesystem(task);
  }

  return {
    task_id: task.task_id,
    status: task.status,
    meta: task.meta,
    steps: task.steps || initSteps()
  };
}

async function getTaskResult(taskId, options = {}) {
  const task = ensureTask(taskId, options);

  const rootDir = task.params.rootDir;
  const id = task.meta.id;
  const baseDir = getWorkDir(rootDir, id);
  const writingDir = path.join(baseDir, 'writing');
  const transcriptDir = path.join(baseDir, 'transcript');
  const mediaDir = path.join(baseDir, 'media');

  updateTaskMetaFromFilesystem(task);

  const outputs = {
    article_path: path.join(writingDir, 'article.md'),
    summary_path: path.join(writingDir, 'summary.md'),
    original_en_md: path.join(transcriptDir, 'original_en.md'),
    original_zh_md: path.join(transcriptDir, 'original_zh.md'),
    video_path: path.join(mediaDir, 'video.mp4'),
    audio_path: path.join(mediaDir, 'audio.m4a')
  };

  return {
    task_id: task.task_id,
    status: task.status,
    meta: task.meta,
    outputs
  };
}

async function getTaskSteps(taskId, options = {}) {
  const task = ensureTask(taskId, options);
  task.steps = task.steps || initSteps();
  return Object.entries(task.steps).map(([name, info]) => ({
    name,
    status: info.status,
    attempts: info.attempts,
    error: info.error
  }));
}

function skipStep(taskId, stepName, options = {}) {
  const task = ensureTask(taskId, options);
  if (!STEPS.includes(stepName)) {
    throw new Error(`unknown step: ${stepName}`);
  }
  task.steps = task.steps || initSteps();
  task.steps[stepName] = { status: 'skipped', attempts: 0, error: null };
  const db = ensureDb(task.params.rootDir);
  db.updateStep(task.meta.id, stepName, 'skipped');
  return { success: true };
}

const VALID_DELETE_MODES = ['hard', 'state', 'soft'];

function deleteTask(taskId, options = {}) {
  const { rootDir, mode = 'hard' } = options;
  if (!VALID_DELETE_MODES.includes(mode)) {
    throw new Error(`invalid delete mode: ${mode}`);
  }
  const workDir = rootDir ? getWorkDir(rootDir, taskId) : null;
  const db = rootDir ? ensureDb(rootDir) : null;

  if (mode === 'soft') {
    if (!db) throw new Error('rootDir required for delete');
    const row = db.getTask(taskId);
    if (!row) throw new Error(`task not found: ${taskId}`);
    db.softDeleteTask(taskId);
    tasks.delete(taskId);
    return;
  }

  if (!db) throw new Error('rootDir required for delete');
  const row = db.getTask(taskId);
  if (!row) throw new Error(`task not found: ${taskId}`);
  db.deleteTask(taskId);
  tasks.delete(taskId);

  if (mode === 'hard' && workDir && fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true });
  }
}

/** For tests: drop task from memory to simulate process restart and test restore from DB */
function _dropTaskFromMemory(taskId) {
  tasks.delete(taskId);
}

module.exports = {
  createTask,
  listTasks,
  runTask,
  runStep,
  skipStep,
  deleteTask,
  getTask,
  getTaskResult,
  getTaskSteps,
  onEvent,
  STEPS,
  _dropTaskFromMemory
};


