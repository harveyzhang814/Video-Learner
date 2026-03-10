'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { generateId } = require('../id');
const { createDb } = require('./db');

// In-memory task store (also persisted to SQLite via ensureDb).
const tasks = new Map();
const dbCache = new Map();

function ensureDb(rootDir) {
  if (!dbCache.has(rootDir)) {
    dbCache.set(rootDir, createDb(rootDir));
  }
  return dbCache.get(rootDir);
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
    const result = await runStepScript(rootDir, stepName, args, { onOutput: options.onOutput });
    if (result.code === 0) {
      stepState.status = 'completed';
      stepState.error = null;
    } else {
      stepState.status = 'failed';
      stepState.error = result.output || 'Step failed';
    }
    task.steps[stepName] = stepState;
    db.updateStep(id, stepName, stepState.status, stepState.error || null);
  }

  updateTaskMetaFromFilesystem(task);

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
}

async function getTask(taskId, options = {}) {
  const task = ensureTask(taskId, options);

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

/** For tests: drop task from memory to simulate process restart and test restore from DB */
function _dropTaskFromMemory(taskId) {
  tasks.delete(taskId);
}

module.exports = { createTask, runTask, runStep, skipStep, getTask, getTaskResult, getTaskSteps, STEPS, _dropTaskFromMemory };


