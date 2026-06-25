'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { generateId } = require('../id');
const { getWorkRoot, getIndexPath, resolveWorkBase } = require('../paths');
const { createDb } = require('./db');
const { validateStepArtifacts, listOriginalMdFiles } = require('./stepArtifacts');
const { computeReadySteps, pickNextStep, pickReadyStepsOrdered, getDownstreamClosure, excludedByMode, normalizeMode, isTaskFailed, isTaskCompleted, getStepTimeoutMs } = require('./schedule');

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
let activeRunTasks = 0;

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
const STEPS = ['fetch', 'video', 'audio', 'subs', 'asr', 'vtt2md', 'translate', 'md2vtt', 'article', 'summary'];

const STEP_SCRIPTS = {
  fetch:     'fetch_info.sh',
  video:     'download_video.sh',
  audio:     'download_audio.sh',
  subs:      'download_subs.sh',
  asr:       'asr_transcribe.sh',
  vtt2md:    'convert_vtt_md.sh',
  translate: 'translate_subs.sh',
  md2vtt:    'convert_md_vtt.sh',
  article:   'generate_article.sh',
  summary:   'generate_summary.sh'
};

function getWorkDir(rootDir, id) {
  return path.join(getWorkRoot(rootDir), id);
}

/**
 * Append a simple JSONL entry to work/index.jsonl for traceability.
 */
function appendIndex(rootDir, record) {
  const indexPath = getIndexPath(rootDir);
  const line = JSON.stringify(record) + '\n';
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.appendFileSync(indexPath, line, 'utf8');
}

function ensureWorkSubdirs(rootDir, id) {
  const dir = getWorkDir(rootDir, id);
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'transcript', 'subs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'writing'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
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
        status:       r.status || 'pending',
        attempts:     r.attempts || 0,
        error:        r.error || null,
        started_at:   r.started_at || null,
        completed_at: r.completed_at || null,
      };
    }
  }

  // D1: backfill translate for tasks created before this step existed.
  // initSteps() always seeds translate=pending in memory; we only need to persist to DB
  // if the row was absent (tasks created before translate was added to STEPS).
  if (!stepsRows.some((r) => r.step_name === 'translate')) {
    db.writeStepState(taskId, 'translate', { status: 'pending', attempts: 0 });
  }

  const statusList = Object.values(steps).map((s) => s.status);
  const tempTask = { params: { mode: normalizeMode(row.mode) }, steps };
  let status = 'pending';
  if (row.status === 'aborted') {
    status = 'aborted'; // restore abort state across process restarts; do not auto-resume
  } else if (statusList.some((s) => s === 'running')) status = 'running';
  else if (isTaskFailed(tempTask))    status = 'failed';
  else if (isTaskCompleted(tempTask)) status = 'completed';

  const task = {
    task_id: taskId,
    status,
    created_at: row.created_at || row.ts,
    updated_at: row.updated_at || row.ts,
    params: {
      url: row.url,
      focus: row.focus || '',
      mode: normalizeMode(row.mode),
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
      mode: normalizeMode(row.mode),
      upload_date: row.upload_date || '',
      download_status: 'pending',
      transcript_done: false,
      article_done: false,
      summary_done: false
    },
    steps,
    processInfo: null,
    _abortFlag: false,
    _currentProcs: {},
    _abortResolvers: [],
    _stepAbortResolves: {}
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
  const { url, focus = '', mode, force = 0, output_lang = 'zh-CN', rootDir, timeout_scale } = params;
  // Validate timeout_scale: must be a positive finite number (1 = default, 3 = long, 6 = ultra-long).
  const normalizedScale = (Number.isFinite(Number(timeout_scale)) && Number(timeout_scale) > 0)
    ? Number(timeout_scale)
    : 1;
  const normalizedMode = normalizeMode(mode);
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
    mode: normalizedMode,
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
    params: { url, focus, mode: normalizedMode, force, output_lang, rootDir, timeout_scale: normalizedScale },
    meta,
    steps: initSteps(),
    processInfo: null,
    _abortFlag: false,
    _currentProcs: {},
    _abortResolvers: [],
    _stepAbortResolves: {}
  };

  tasks.set(taskId, task);

  const db = ensureDb(rootDir);
  db.createTask(id, url);
  db.updateTask(id, { url, title: '', focus, output_lang, mode: normalizedMode, timeout_scale: normalizedScale });
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
    title: task.meta.title,
    duration: task.meta.duration,
    lang: task.meta.lang,
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
    const audioPath = path.join(mediaDir, 'audio.m4a');
    if (fs.existsSync(videoPath)) {
      meta.download_status = 'success';
    }

    // Probe media file for width/height/file_size/bit_rate if not yet stored
    if (!task.meta.file_size) {
      const probePath = fs.existsSync(videoPath) ? videoPath
        : fs.existsSync(audioPath) ? audioPath
        : null;
      if (probePath) {
        try {
          const raw = execFileSync('ffprobe', [
            '-v', 'quiet', '-print_format', 'json',
            '-show_streams', '-show_format', probePath,
          ], { encoding: 'utf8', timeout: 10000 });
          const data = JSON.parse(raw);
          const vStream = (data.streams || []).find((s) => s.codec_type === 'video');
          const fmt = data.format || {};
          const probeFields = {
            width:     vStream ? (vStream.width || null) : null,
            height:    vStream ? (vStream.height || null) : null,
            file_size: fmt.size ? parseInt(fmt.size, 10) : null,
            bit_rate:  fmt.bit_rate ? parseInt(fmt.bit_rate, 10) : null,
          };
          Object.assign(task.meta, probeFields);
          ensureDb(rootDir).updateTask(id, probeFields);
        } catch (_) {
          // ffprobe failure is non-fatal
        }
      }
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
function spawnEnv(rootDir) {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
  const pathList = [process.env.PATH, ...extra].filter(Boolean);
  const PATH = [...new Set(pathList.join(':').split(':'))].filter(Boolean).join(':');
  const env = { ...process.env, PATH };
  if (rootDir) env.WORK_ROOT = resolveWorkBase(rootDir);
  return env;
}

function tryDeleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

/**
 * Low-level helper to run a single step script and collect its exit code/output.
 * opts.onOutput(text) optional - called for each stdout/stderr chunk (e.g. for Electron log stream).
 */
function runStepScript(rootDir, stepName, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join(rootDir, 'scripts', STEP_SCRIPTS[stepName]);
    const proc = spawn('bash', [script, ...args], { cwd: rootDir, env: spawnEnv(rootDir), detached: true });
    if (opts.onProc) opts.onProc(proc);

    let output = '';
    let settled = false;

    const onStdoutChunk = (data) => {
      const text = data.toString();
      output += text;
      if (opts.onOutput) opts.onOutput(text);
      if (opts.onStdout) opts.onStdout(text);
    };
    const onStderrChunk = (data) => {
      const text = data.toString();
      output += text;
      if (opts.onOutput) opts.onOutput(text);
      if (opts.onStderr) opts.onStderr(text);
    };
    proc.stdout.on('data', onStdoutChunk);
    proc.stderr.on('data', onStderrChunk);

    // Per-step timeout: kill process group and resolve with timedOut flag.
    // opts.timeoutMs is an absolute override; opts.timeoutScale multiplies the default.
    const timeoutMs = opts.timeoutMs ?? getStepTimeoutMs(stepName, opts.timeoutScale);
    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const sigkillTimer = setTimeout(() => {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
      }, 5000);
      try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) {}
      proc.once('close', () => clearTimeout(sigkillTimer));
      resolve({ code: null, output, timedOut: true, timeoutMs });
    }, timeoutMs);

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      resolve({ code, output });
    });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      reject(err);
    });
  });
}

/**
 * Run a single logical step and update in-memory step status.
 * options: { focus, force, timeoutScale }
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

  // video skipped when only audio or transcript is wanted
  if (stepName === 'video' && (mode === 'audio' || mode === 'transcript')) {
    stepState.status = 'skipped';
    task.steps[stepName] = stepState;
    db.updateStep(id, stepName, 'skipped');
    return { success: true, skipped: true };
  }
  // audio skipped only for transcript mode;
  // in media mode the scheduler gates audio until video fails (never reaches here pre-failure)
  if (stepName === 'audio' && mode === 'transcript') {
    stepState.status = 'skipped';
    task.steps[stepName] = stepState;
    db.updateStep(id, stepName, 'skipped');
    return { success: true, skipped: true };
  }
  // asr is never applicable in transcript mode (no media file to transcribe)
  if (stepName === 'asr' && mode === 'transcript') {
    stepState.status = 'skipped';
    task.steps[stepName] = stepState;
    db.updateStep(id, stepName, 'skipped');
    return { success: true, skipped: true };
  }

  // A-layer: required artifacts / writable paths only (no upstream step status).
  const pre = validateStepArtifacts(task, stepName);
  if (!pre.ok) {
    const prevAttempts = stepState.attempts || 0;
    const nextAttempts = prevAttempts + 1;
    stepState.status = 'failed';
    stepState.error = pre.error;
    stepState.attempts = nextAttempts;
    task.steps[stepName] = stepState;
    task.updated_at = new Date().toISOString();
    db.updateStep(id, stepName, 'failed', pre.error);
    emitOrchestratorEvent('step.finished', taskId, {
      stepName,
      status: 'failed',
      error: pre.error
    });
    emitOrchestratorEvent('task.updated', taskId, {
      status: task.status,
      stepName,
      stepStatus: 'failed'
    });
    return { success: false, error: pre.error };
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

  // Per-step unified logging:
  // - raw: work/<id>/logs/<step>.raw.log
  // - jsonl: work/<id>/logs/task.log.jsonl
  const logsDir = path.join(dir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const rawPath = path.join(logsDir, `${stepName}.raw.log`);
  const jsonlPath = path.join(logsDir, 'task.log.jsonl');

  const rawStream = fs.createWriteStream(rawPath, { flags: 'a' });
  const jsonlStream = fs.createWriteStream(jsonlPath, { flags: 'a' });

  let stdoutBuf = '';
  let stderrBuf = '';
  let logsFinished = false;

  function getLevel(line) {
    if (!line) return 'info';
    if (/exception|traceback|error|failed|Error|Failed/i.test(line)) return 'error';
    if (/warning|warn|WARN/i.test(line)) return 'warn';
    return 'info';
  }

  function getSourceAndProgress(line) {
    const parsed = parseYtDlpProgressLine(line.trim());
    if (parsed) {
      const { downloaded, total, speed, eta } = parsed;
      const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((downloaded / total) * 100))) : null;
      return { source: 'yt-dlp', progress: { downloaded, total, speed, eta, percent } };
    }
    // Heuristic: ffmpeg progress lines usually contain both frame= and time=
    if (/\bframe\s*=\s*\d+/.test(line) || /\btime\s*=\s*\d{2}:\d{2}:\d{2}/.test(line)) {
      return { source: 'ffmpeg' };
    }
    return { source: 'script/other' };
  }

  function emitJsonlRecord({ stream, line }) {
    const trimmed = String(line || '').trimEnd();
    if (!trimmed.trim()) return;
    const ts = new Date().toISOString();
    const { source, progress } = getSourceAndProgress(trimmed);
    const level = getLevel(trimmed);
    const record = {
      ts,
      taskId,
      step: stepName,
      attempt: stepState.attempts,
      stream,
      source,
      level,
      line: trimmed
    };
    if (progress) record.progress = progress;
    jsonlStream.write(`${JSON.stringify(record)}\n`);
  }

  function handleChunkText(text, stream) {
    const s = String(text || '');
    rawStream.write(s);
    if (stream === 'stdout') stdoutBuf += s;
    else stderrBuf += s;

    const buf = stream === 'stdout' ? stdoutBuf : stderrBuf;
    const parts = buf.split(/\r?\n/);
    const tail = parts.pop() || '';
    if (stream === 'stdout') stdoutBuf = tail;
    else stderrBuf = tail;

    for (const line of parts) {
      emitJsonlRecord({ stream, line });
    }
  }

  const onStdout = (text) => handleChunkText(text, 'stdout');
  const onStderr = (text) => handleChunkText(text, 'stderr');

  function finishLogs() {
    if (logsFinished) return;
    logsFinished = true;
    try {
      if (stdoutBuf && stdoutBuf.trim()) emitJsonlRecord({ stream: 'stdout', line: stdoutBuf });
      if (stderrBuf && stderrBuf.trim()) emitJsonlRecord({ stream: 'stderr', line: stderrBuf });
    } catch (_) {
      // ignore
    }
    try {
      rawStream.end();
    } catch (_) {
      // ignore
    }
    try {
      jsonlStream.end();
    } catch (_) {
      // ignore
    }
  }

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
    case 'asr':
      args = [url, dir, id, task.meta.lang || 'en'];
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
          const result = await runStepScript(rootDir, 'vtt2md', [path.join(subsDir, vtt), outPath], {
            onOutput: options.onOutput,
            onStdout,
            onStderr,
            onProc: (proc) => { task._currentProcs[stepName] = proc; },
            timeoutScale: options.timeoutScale,
          });
          delete task._currentProcs[stepName];
          if (task._abortFlag || task._stepAbortResolves[stepName]) break;
          if (result.code !== 0) {
            errors.push(`${vtt}: ${result.output || 'failed'}`);
          }
        } catch (e) {
          delete task._currentProcs[stepName];
          errors.push(`${vtt}: ${e.message}`);
        }
      }
      // Abort check after loop (covers both task-level and step-level abort).
      if (task._stepAbortResolves[stepName]) {
        const resolve = task._stepAbortResolves[stepName];
        delete task._stepAbortResolves[stepName];
        stepState.status = 'pending';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'pending');
        finishLogs();
        emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'pending', aborted: true });
        emitOrchestratorEvent('task.updated', taskId, { status: task.status, stepName, stepStatus: 'pending' });
        resolve();
        return { success: false, error: 'aborted' };
      }
      if (task._abortFlag) {
        finishLogs();
        return { success: false, error: 'aborted' };
      }
      if (errors.length > 0) {
        stepState.status = 'failed';
        stepState.error = errors.join('\n');
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'failed', stepState.error);
        finishLogs();
        return { success: false, error: stepState.error };
      }
      stepState.status = 'completed';
      task.steps[stepName] = stepState;
      db.updateStep(id, stepName, 'completed');
      updateTaskMetaFromFilesystem(task);
      finishLogs();
      return { success: true };
    }
    case 'translate': {
      const outputLang = (task.params && task.params.output_lang) || 'zh-CN';

      // Skip-3: 目标语言非中文
      if (!outputLang.startsWith('zh')) {
        stepState.status = 'skipped';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'skipped');
        finishLogs();
        return { success: true };
      }
      // Skip-1: original_zh.md 已存在
      if (fs.existsSync(zhMd)) {
        stepState.status = 'skipped';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'skipped');
        finishLogs();
        return { success: true };
      }
      // Skip-2: original_en.md 不存在
      if (!fs.existsSync(enMd)) {
        stepState.status = 'skipped';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'skipped');
        finishLogs();
        return { success: true };
      }

      const result = await runStepScript(rootDir, 'translate', [enMd, zhMd], {
        onOutput: options.onOutput,
        onStdout,
        onStderr,
        onProc: (proc) => { task._currentProcs[stepName] = proc; },
        timeoutScale: options.timeoutScale,
      });
      delete task._currentProcs[stepName];

      if (task._stepAbortResolves[stepName]) {
        const resolve = task._stepAbortResolves[stepName];
        delete task._stepAbortResolves[stepName];
        stepState.status = 'pending';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'pending');
        finishLogs();
        emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'pending', aborted: true });
        emitOrchestratorEvent('task.updated', taskId, { status: task.status, stepName, stepStatus: 'pending' });
        resolve();
        return { success: false, error: 'aborted' };
      }
      if (task._abortFlag) {
        finishLogs();
        return { success: false, error: 'aborted' };
      }
      if (result.code !== 0) {
        stepState.status = 'failed';
        stepState.error = result.output || 'translate_subs.sh failed';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'failed', stepState.error);
        finishLogs();
        return { success: false, error: stepState.error };
      }
      stepState.status = 'completed';
      task.steps[stepName] = stepState;
      db.updateStep(id, stepName, 'completed');
      finishLogs();
      return { success: true };
    }
    case 'md2vtt': {
      const errors = [];
      const mdNames = listOriginalMdFiles(path.join(dir, 'transcript'));
      for (const name of mdNames) {
        const mdPath = path.join(dir, 'transcript', name);
        try {
          const result = await runStepScript(rootDir, 'md2vtt', [mdPath, mdPath.replace('.md', '.vtt')], {
            onOutput: options.onOutput,
            onStdout,
            onStderr,
            onProc: (proc) => { task._currentProcs[stepName] = proc; },
            timeoutScale: options.timeoutScale,
          });
          delete task._currentProcs[stepName];
          if (task._abortFlag || task._stepAbortResolves[stepName]) break;
          if (result.code !== 0) {
            errors.push(`${name}: ${result.output || 'failed'}`);
          }
        } catch (e) {
          delete task._currentProcs[stepName];
          errors.push(`${name}: ${e.message}`);
        }
      }
      if (task._stepAbortResolves[stepName]) {
        const resolve = task._stepAbortResolves[stepName];
        delete task._stepAbortResolves[stepName];
        stepState.status = 'pending';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'pending');
        finishLogs();
        emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'pending', aborted: true });
        emitOrchestratorEvent('task.updated', taskId, { status: task.status, stepName, stepStatus: 'pending' });
        resolve();
        return { success: false, error: 'aborted' };
      }
      if (task._abortFlag) {
        finishLogs();
        return { success: false, error: 'aborted' };
      }
      if (errors.length > 0) {
        stepState.status = 'failed';
        stepState.error = errors.join('\n');
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'failed', stepState.error);
        finishLogs();
        return { success: false, error: stepState.error };
      }
      stepState.status = 'completed';
      task.steps[stepName] = stepState;
      db.updateStep(id, stepName, 'completed');
      updateTaskMetaFromFilesystem(task);
      finishLogs();
      return { success: true };
    }
    case 'article': {
      let transcriptPath = fs.existsSync(enMd) ? enMd : fs.existsSync(zhMd) ? zhMd : null;
      if (!transcriptPath) {
        const names = listOriginalMdFiles(path.join(dir, 'transcript'));
        transcriptPath = path.join(dir, 'transcript', names[0]);
      }
      const outPath = path.join(dir, 'writing', 'article.md');
      args = [transcriptPath, outPath, task.meta.output_lang || 'zh-CN'];
      break;
    }
    case 'summary': {
      const articlePath = path.join(dir, 'writing', 'article.md');
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

    const result = await runStepScript(rootDir, stepName, args, {
      onOutput,
      onStdout,
      onStderr,
      onProc: (proc) => { task._currentProcs[stepName] = proc; },
      timeoutScale: options.timeoutScale,
    });
    delete task._currentProcs[stepName];
    // Step-level abort: runStep resets step to pending and notifies abortStep.
    if (task._stepAbortResolves[stepName]) {
      const resolve = task._stepAbortResolves[stepName];
      delete task._stepAbortResolves[stepName];
      if (stepName === 'article') tryDeleteFile(path.join(dir, 'writing', 'article.md'));
      if (stepName === 'summary') tryDeleteFile(path.join(dir, 'writing', 'summary.md'));
      stepState.status = 'pending';
      task.steps[stepName] = stepState;
      db.updateStep(id, stepName, 'pending');
      finishLogs();
      emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'pending', aborted: true });
      emitOrchestratorEvent('task.updated', taskId, { status: task.status, stepName, stepStatus: 'pending' });
      resolve();
      return { success: false, error: 'aborted' };
    }
    // Task-level abort: runTask's finally block handles state cleanup.
    if (task._abortFlag) {
      finishLogs();
      return { success: false, error: 'aborted' };
    }
    if (result.timedOut) {
      stepState.status = 'failed';
      const mins = Math.round(result.timeoutMs / 60000);
      stepState.error = `Step timed out after ${mins} min`;
    } else if (result.code === 0) {
      stepState.status = 'completed';
      stepState.error = null;
    } else {
      stepState.status = 'failed';
      stepState.error = formatStepError(result.code, result.output);
    }
    task.steps[stepName] = stepState;
    db.updateStep(id, stepName, stepState.status, stepState.error || null);
  }

  finishLogs();
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
 * Reset step(s) for reset_scope: 'step' | 'downstream'. Does not run anything.
 * @returns {{ reset_steps: string[] }}
 */
function applyResetScope(taskId, stepName, scope, options = {}) {
  if (scope !== 'step' && scope !== 'downstream') {
    const e = new Error(`invalid reset scope: ${scope}`);
    e.code = 'BAD_SCOPE';
    throw e;
  }

  const task = ensureTask(taskId, options);
  if (!STEPS.includes(stepName)) {
    const e = new Error(`unknown step: ${stepName}`);
    e.code = 'BAD_STEP';
    throw e;
  }

  const mode = (task.params && task.params.mode) || 'media';
  if (excludedByMode(mode, task.steps).has(stepName)) {
    const e = new Error('invalid resume anchor for mode');
    e.code = 'BAD_ANCHOR_MODE';
    throw e;
  }

  const anchor = task.steps && task.steps[stepName];
  if (anchor && anchor.status === 'skipped') {
    const e = new Error('anchor step is skipped');
    e.code = 'ANCHOR_SKIPPED';
    throw e;
  }

  if (task.status === 'running') {
    const e = new Error('task is running');
    e.code = 'TASK_OR_STEP_RUNNING';
    throw e;
  }
  for (const name of STEPS) {
    const s = task.steps && task.steps[name];
    if (s && s.status === 'running') {
      const e = new Error('a step is running');
      e.code = 'TASK_OR_STEP_RUNNING';
      throw e;
    }
  }

  const db = ensureDb(task.params.rootDir);
  const id = task.meta.id;
  task.steps = task.steps || initSteps();
  const resetList = [];

  const markPending = (name) => {
    if (!STEPS.includes(name)) return;
    const cur = task.steps[name];
    if (cur && cur.status === 'skipped') return;
    task.steps[name] = { status: 'pending', attempts: 0, error: null };
    db.writeStepState(id, name, { status: 'pending', attempts: 0, error: null });
    resetList.push(name);
  };

  if (scope === 'step') {
    markPending(stepName);
  } else {
    const closure = getDownstreamClosure(stepName);
    for (const name of closure) {
      markPending(name);
    }
  }

  task.updated_at = new Date().toISOString();
  return { reset_steps: resetList };
}

/**
 * Max steps allowed to run concurrently within a single runTask.
 * Override via VL_MAX_PARALLEL_STEPS (integer >= 1); invalid values fall back to 3.
 */
function getMaxParallelSteps() {
  const n = Number(process.env.VL_MAX_PARALLEL_STEPS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
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

  activeRunTasks += 1;
  task.status = 'running';
  task.updated_at = new Date().toISOString();
  emitOrchestratorEvent('task.updated', taskId, { status: task.status });

  const { mode, focus } = task.params;

  try {
    // B-layer: DAG readiness + bounded-concurrency pool scheduler.
    // Main-chain steps fill slots first (pickReadyStepsOrdered preserves priority);
    // up to N steps run concurrently. A finished/failed step frees a slot.
    const N = getMaxParallelSteps();
    const inFlight = new Map(); // stepName -> Promise<{ stepName }>

    function buildStepOptions(next) {
      const stepOptions = { ...options };
      if (task.params.timeout_scale && task.params.timeout_scale !== 1) {
        stepOptions.timeoutScale = task.params.timeout_scale;
      }
      if (next === 'video' || next === 'audio') {
        stepOptions.force = task.params.force;
      }
      if (next === 'summary') {
        let summaryFocus = options.focus;
        if (summaryFocus === undefined || String(summaryFocus).trim() === '') {
          const db = ensureDb(task.params.rootDir);
          const row = db.getTask(task.meta.id);
          summaryFocus = (row && row.focus) || focus || task.meta.focus || '';
        }
        stepOptions.focus = String(summaryFocus || '').trim() || '视频的主要内容和要点';
      }
      return stepOptions;
    }

    // Safety bound on scheduler iterations (steps may reset to pending on step-abort).
    let guard = 0;
    const GUARD_MAX = 256;
    while (guard++ < GUARD_MAX) {
      if (!task._abortFlag) {
        const ready = computeReadySteps(task);                 // 'running' steps excluded
        const ordered = pickReadyStepsOrdered(ready, mode, task.steps);
        for (const next of ordered) {
          if (inFlight.size >= N) break;
          if (inFlight.has(next)) continue;                    // defensive
          const p = runStep(taskId, next, buildStepOptions(next))
            .then(() => ({ stepName: next }))
            .catch(() => ({ stepName: next }));
          inFlight.set(next, p);
        }
      }
      if (inFlight.size === 0) break;                          // nothing in flight & nothing ready
      const settled = await Promise.race(inFlight.values());
      inFlight.delete(settled.stepName);
    }

    if (!task._abortFlag) {
      updateTaskMetaFromFilesystem(task);

      // Mark overall task status using DAG reachability.
      task.status = isTaskFailed(task) ? 'failed' : (isTaskCompleted(task) ? 'completed' : task.status);
      task.updated_at = new Date().toISOString();
      emitOrchestratorEvent('task.updated', taskId, { status: task.status });
    }
  } finally {
    // Decrement active counter exactly once per runTask invocation.
    activeRunTasks = Math.max(0, activeRunTasks - 1);

    if (task._abortFlag) {
      try {
        const _rootDir = task.params && task.params.rootDir;
        const _id = task.meta && task.meta.id;
        if (_rootDir && _id) {
          const db = ensureDb(_rootDir);
          const workDir = getWorkDir(_rootDir, _id);
          for (const stepName of STEPS) {
            const s = task.steps && task.steps[stepName];
            if (s && s.status === 'running') {
              if (stepName === 'article') tryDeleteFile(path.join(workDir, 'writing', 'article.md'));
              if (stepName === 'summary') tryDeleteFile(path.join(workDir, 'writing', 'summary.md'));
              task.steps[stepName] = { status: 'pending', attempts: s.attempts, error: null };
              db.updateStep(_id, stepName, 'pending');
            }
          }
          db.updateTask(_id, { status: 'aborted' });
        }
        task.status = 'aborted';
        task.updated_at = new Date().toISOString();
        emitOrchestratorEvent('task.updated', taskId, { status: 'aborted' });
      } catch (_) {}
      task._abortFlag = false;
      task._currentProcs = {};
      task._stepAbortResolves = {};
      const resolvers = task._abortResolvers.splice(0);
      resolvers.forEach((r) => r());
    } else {
      try {
        // Re-check outputs and reconcile step/meta state one last time.
        updateTaskMetaFromFilesystem(task);

        const rootDir = task.params && task.params.rootDir;
        const id = task.meta && task.meta.id;
        if (rootDir && id) {
          const db = ensureDb(rootDir);
          const steps = task.steps || initSteps();

          const baseDir = getWorkDir(rootDir, id);
          const transcriptDir = path.join(baseDir, 'transcript');
          const writingDir = path.join(baseDir, 'writing');
          const hasTranscript = fs.existsSync(path.join(transcriptDir, 'original_en.md')) || fs.existsSync(path.join(transcriptDir, 'original_zh.md'));
          const hasArticle = fs.existsSync(path.join(writingDir, 'article.md'));
          const hasSummary = fs.existsSync(path.join(writingDir, 'summary.md'));

          // Only reconcile statuses if they look inconsistent with filesystem outputs.
          if (hasTranscript && (steps.vtt2md?.status === 'failed' || steps.vtt2md?.status === 'pending')) {
            steps.vtt2md = { ...(steps.vtt2md || {}), status: 'completed', error: null };
            db.updateStep(id, 'vtt2md', 'completed');
          }
          if (hasArticle && (steps.article?.status === 'failed' || steps.article?.status === 'pending')) {
            steps.article = { ...(steps.article || {}), status: 'completed', error: null };
            db.updateStep(id, 'article', 'completed');
          }
          if (hasSummary && (steps.summary?.status === 'failed' || steps.summary?.status === 'pending')) {
            steps.summary = { ...(steps.summary || {}), status: 'completed', error: null };
            db.updateStep(id, 'summary', 'completed');
          }

          // If outputs are missing but step says completed, mark failed (keep error light).
          if (!hasArticle && steps.article?.status === 'completed') {
            steps.article = { ...(steps.article || {}), status: 'failed', error: 'article.md missing after step completed' };
            db.updateStep(id, 'article', 'failed', steps.article.error);
          }
          if (!hasSummary && steps.summary?.status === 'completed') {
            steps.summary = { ...(steps.summary || {}), status: 'failed', error: 'summary.md missing after step completed' };
            db.updateStep(id, 'summary', 'failed', steps.summary.error);
          }

          task.steps = steps;

          // Re-evaluate overall task status after filesystem reconciliation.
          const reconStatus = isTaskFailed(task) ? 'failed' : (isTaskCompleted(task) ? 'completed' : task.status);
          if (task.status !== reconStatus) {
            task.status = reconStatus;
            task.updated_at = new Date().toISOString();
            emitOrchestratorEvent('task.updated', taskId, { status: task.status });
          }

          emitOrchestratorEvent('task.finalized', taskId, {
            outputs: { transcript: hasTranscript, article: hasArticle, summary: hasSummary }
          });

          // Stop opencode server for this repo when no other runTask is active.
          // (Future-proof for concurrency: only last task triggers stop.)
          if (activeRunTasks === 0) {
            try {
              const script = path.join(rootDir, 'scripts', 'opencode_server.sh');
              // Run stop as a standalone bash command (not a step).
              await new Promise((resolve) => {
                const proc = spawn('bash', [script, 'stop-if-started'], { cwd: rootDir, env: spawnEnv(rootDir) });
                proc.on('close', () => resolve());
                proc.on('error', () => resolve());
              });
            } catch (_) {
              // ignore
            }
          }
        }
      } catch (_) {
        // ignore finalize errors
      }
    }
  }
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
      if (row.uploader != null && row.uploader !== '') task.meta.uploader = row.uploader;
      if (row.upload_date != null && row.upload_date !== '') task.meta.upload_date = row.upload_date;
    }
    // Refresh step timestamps from DB — in-memory stepState never tracks started_at/completed_at
    if (task.steps) {
      for (const r of db.getSteps(task.meta.id)) {
        if (task.steps[r.step_name]) {
          if (r.started_at)   task.steps[r.step_name].started_at   = r.started_at;
          if (r.completed_at) task.steps[r.step_name].completed_at = r.completed_at;
        }
      }
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
  // Refresh timestamps from DB — in-memory stepState never tracks started_at/completed_at
  const rootDir = task.params && task.params.rootDir;
  if (rootDir) {
    const db = ensureDb(rootDir);
    for (const r of db.getSteps(task.meta.id)) {
      if (task.steps[r.step_name]) {
        if (r.started_at)   task.steps[r.step_name].started_at   = r.started_at;
        if (r.completed_at) task.steps[r.step_name].completed_at = r.completed_at;
      }
    }
  }
  return Object.entries(task.steps).map(([name, info]) => ({
    name,
    status:       info.status,
    attempts:     info.attempts,
    error:        info.error,
    started_at:   info.started_at || null,
    completed_at: info.completed_at || null,
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

  if (!db) throw new Error('rootDir required for delete');
  const row = db.getTask(taskId);
  if (!row) throw new Error(`task not found: ${taskId}`);

  // Guard: refuse to hard/soft-delete a running task (state mode is a reset
  // and is intentionally allowed mid-run so callers can restart cleanly).
  const inMem = tasks.get(taskId);
  if (mode !== 'state' && inMem) {
    if (inMem.status === 'running') {
      const e = new Error('task is running');
      e.code = 'TASK_OR_STEP_RUNNING';
      throw e;
    }
    if (inMem.steps) {
      for (const name of STEPS) {
        const s = inMem.steps[name];
        if (s && s.status === 'running') {
          const e = new Error('a step is running');
          e.code = 'TASK_OR_STEP_RUNNING';
          throw e;
        }
      }
    }
  } else if (mode !== 'state') {
    // Not in memory — check the steps table persisted to DB
    const runningStep = db.getSteps(taskId).find((s) => s.status === 'running');
    if (runningStep) {
      const e = new Error('a step is running');
      e.code = 'TASK_OR_STEP_RUNNING';
      throw e;
    }
  }

  if (mode === 'soft') {
    db.softDeleteTask(taskId);
    tasks.delete(taskId);
    return;
  }
  db.deleteTask(taskId);
  tasks.delete(taskId);

  if (mode === 'hard' && workDir && fs.existsSync(workDir)) {
    fs.rmSync(workDir, { recursive: true });
  }
}

async function abortTask(taskId, options = {}) {
  const task = ensureTask(taskId, options);
  if (task.status !== 'running') {
    const e = new Error('task is not running');
    e.code = 'NOT_RUNNING';
    throw e;
  }

  const waitDone = new Promise((resolve) => task._abortResolvers.push(resolve));

  task._abortFlag = true;

  const procs = Object.values(task._currentProcs).filter((p) => p && p.pid);
  if (procs.length > 0) {
    const sigkillTimer = setTimeout(() => {
      for (const p of procs) {
        try { process.kill(-p.pid, 'SIGKILL'); } catch (_) {}
      }
    }, 5000);
    waitDone.then(() => clearTimeout(sigkillTimer));
    for (const p of procs) {
      try { process.kill(-p.pid, 'SIGTERM'); } catch (_) {}
    }
  } else {
    // No proc running (between steps): DAG loop will see _abortFlag and break,
    // then the finally block calls resolvers. Nothing extra needed here.
  }

  await waitDone;
  return { task_id: taskId, status: 'aborted' };
}

async function abortStep(taskId, stepName, options = {}) {
  const task = ensureTask(taskId, options);
  if (!STEPS.includes(stepName)) {
    const e = new Error(`unknown step: ${stepName}`);
    e.code = 'BAD_STEP';
    throw e;
  }
  const s = task.steps && task.steps[stepName];
  if (!s || s.status !== 'running') {
    const e = new Error('step is not running');
    e.code = 'STEP_NOT_RUNNING';
    throw e;
  }

  if (task._stepAbortResolves[stepName]) {
    const e = new Error('step abort already in progress');
    e.code = 'STEP_ABORT_IN_PROGRESS';
    throw e;
  }

  const waitDone = new Promise((resolve) => { task._stepAbortResolves[stepName] = resolve; });

  const proc = task._currentProcs[stepName];
  if (proc && proc.pid) {
    const sigkillTimer = setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
    }, 5000);
    waitDone.then(() => clearTimeout(sigkillTimer));
    try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) {}
  }

  await waitDone;
  return { task_id: taskId, step: stepName, status: 'pending' };
}

async function resumeTask(taskId, options = {}) {
  const task = ensureTask(taskId, options);
  if (task.status !== 'aborted') {
    const e = new Error('task is not aborted');
    e.code = 'NOT_ABORTED';
    throw e;
  }
  // runTask sets status='running' synchronously before any async ops; no race condition
  runTask(taskId).catch((err) => console.error(`[resume] ${err.message}`));
  return { task_id: taskId, status: 'running' };
}

/** For tests: drop task from memory to simulate process restart and test restore from DB */
function _dropTaskFromMemory(taskId) {
  tasks.delete(taskId);
}

/**
 * Returns the number of runTask() invocations currently in flight.
 * Used by the HTTP server's auto-shutdown check to avoid killing the
 * backend while tasks are still running — even after all clients disconnect.
 */
function getActiveTaskCount() {
  return activeRunTasks;
}

module.exports = {
  createTask,
  listTasks,
  runTask,
  runStep,
  abortTask,
  abortStep,
  resumeTask,
  applyResetScope,
  skipStep,
  deleteTask,
  getTask,
  getTaskResult,
  getTaskSteps,
  onEvent,
  STEPS,
  _dropTaskFromMemory,
  validateStepArtifacts,
  getActiveTaskCount,
};


