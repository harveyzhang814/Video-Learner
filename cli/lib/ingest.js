'use strict';
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const { generateId } = require('../../core/id');
const { getDbPath, getTaskDirs } = require('../../core/paths');
const { createDb } = require('../../core/orchestrator/db');

const AUDIO_EXTS = new Set(['mp3','m4a','wav','aac','flac','ogg','opus']);
const VIDEO_EXTS = new Set(['mp4','mkv','mov','avi','webm','ts','m4v']);

function isLocalPath(s) {
  return s.startsWith('/') || s.startsWith('./') || s.startsWith('../');
}

function detectFileType(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return null;
}

async function ingestLocalFile(filePath, opts = {}) {
  const {
    focus = '',
    srcLang = 'en',
    outputLang = 'zh-CN',
    mode: modeOverride = null,
    timeoutScale = 1,
  } = opts;

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);

  const fileType = detectFileType(absPath);
  if (!fileType) throw new Error(`Unsupported file extension: ${path.extname(absPath) || '(none)'}`);

  const mode = modeOverride || (fileType === 'audio' ? 'audio' : 'media');
  const fakeUrl = `local://${absPath}`;
  const taskId = generateId(fakeUrl);
  const projectRoot = path.resolve(__dirname, '../..');
  const dirs = getTaskDirs(projectRoot, taskId);

  // Initialize DB tables via the manager (runs migrations / creates schema)
  createDb(projectRoot).close();

  fs.mkdirSync(dirs.media, { recursive: true });
  fs.mkdirSync(path.join(dirs.base, 'transcript', 'subs'), { recursive: true });
  fs.mkdirSync(dirs.writing, { recursive: true });

  const audioDest = path.join(dirs.media, 'audio.m4a');
  const videoDest = path.join(dirs.media, 'video.mp4');
  const srcExt = path.extname(absPath).slice(1).toLowerCase();

  if (fileType === 'audio') {
    if (srcExt === 'm4a') {
      fs.copyFileSync(absPath, audioDest);
    } else {
      execSync(
        `ffmpeg -y -i ${JSON.stringify(absPath)} -c:a aac -b:a 128k ${JSON.stringify(audioDest)}`,
        { stdio: 'inherit' }
      );
    }
  } else {
    // video: extract audio first (always needed for ASR)
    execSync(
      `ffmpeg -y -i ${JSON.stringify(absPath)} -vn -c:a aac -b:a 128k ${JSON.stringify(audioDest)}`,
      { stdio: 'inherit' }
    );
    if (mode !== 'audio') {
      if (srcExt === 'mp4') {
        fs.copyFileSync(absPath, videoDest);
      } else {
        execSync(
          `ffmpeg -y -i ${JSON.stringify(absPath)} -c copy ${JSON.stringify(videoDest)}`,
          { stdio: 'inherit' }
        );
      }
    }
  }

  // Open raw DB connection only after ffmpeg has completed successfully
  const dbPath = getDbPath(projectRoot);
  const db = new Database(dbPath);

  const now = new Date().toISOString();
  const title = path.basename(absPath);
  const videoStatus = (fileType === 'video' && mode !== 'audio') ? 'completed' : 'skipped';

  db.prepare(`
    INSERT OR REPLACE INTO tasks
      (id, url, ts, title, lang, output_lang, focus, mode, status, timeout_scale, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(taskId, fakeUrl, now, title, srcLang, outputLang, focus, mode, timeoutScale, now, now);

  const seeded = [
    { step: 'fetch',  status: 'skipped',   extra: { attempts: 1, completed_at: now } },
    { step: 'video',  status: videoStatus,  extra: { attempts: 1, completed_at: now } },
    { step: 'audio',  status: 'completed',  extra: { attempts: 1, completed_at: now } },
    { step: 'subs',   status: 'failed',     extra: { attempts: 1, error: 'no subtitles — local file ingest' } },
  ];
  for (const { step, status, extra } of seeded) {
    const cols = ['task_id', 'step_name', 'status', ...Object.keys(extra)];
    const vals = [taskId, step, status, ...Object.values(extra)];
    db.prepare(
      `INSERT OR REPLACE INTO steps (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    ).run(...vals);
  }
  for (const step of ['asr', 'vtt2md', 'translate', 'md2vtt', 'article', 'summary']) {
    db.prepare(
      `INSERT OR REPLACE INTO steps (task_id, step_name, status, attempts) VALUES (?, ?, 'pending', 0)`
    ).run(taskId, step);
  }

  db.close();
  return taskId;
}

module.exports = { isLocalPath, detectFileType, ingestLocalFile };
