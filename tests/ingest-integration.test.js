'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const { ingestLocalFile } = require('../cli/lib/ingest');
const { generateId } = require('../core/id');

// ── Audio integration test setup ──────────────────────────────────────────────

const AUDIO_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-ingest-audio-'));
const AUDIO_FILE = path.join(AUDIO_TMP, 'test.mp3');

// generate a 1-second silent mp3 using ffmpeg
try {
  execSync(
    `ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=mono" -t 1 -q:a 9 -acodec libmp3lame ${JSON.stringify(AUDIO_FILE)}`,
    { stdio: 'pipe' }
  );
} catch (e) {
  console.error('ffmpeg not available — skipping integration test');
  process.exit(0);
}

// ── Video integration test setup ──────────────────────────────────────────────

const VIDEO_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-ingest-video-'));
const VIDEO_FILE = path.join(VIDEO_TMP, 'test.mp4');

// generate a 1-second silent mp4 using ffmpeg
try {
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc -t 1 -c:v libx264 -c:a aac ${JSON.stringify(VIDEO_FILE)}`,
    { stdio: 'pipe' }
  );
} catch (e) {
  console.log('ffmpeg video codec not available — skipping video integration test');
  fs.rmSync(VIDEO_TMP, { recursive: true, force: true });
  process.exit(0);
}

// ── Run tests sequentially ────────────────────────────────────────────────────

(async () => {
  // ── Audio test ──────────────────────────────────────────────────────────────
  const origWorkRoot1 = process.env.WORK_ROOT;
  const audioWorkRoot = path.join(AUDIO_TMP, 'work-root');
  process.env.WORK_ROOT = audioWorkRoot;
  try {
    const taskId = await ingestLocalFile(AUDIO_FILE, {
      focus: 'test focus',
      srcLang: 'en',
      outputLang: 'zh-CN',
    });

    const expectedId = generateId(`local://${AUDIO_FILE}`);
    assert.strictEqual(taskId, expectedId, 'task ID matches');

    // audio.m4a must exist
    const workDir = path.join(audioWorkRoot, 'work', taskId);
    const audioPath = path.join(workDir, 'media', 'audio.m4a');
    assert.ok(fs.existsSync(audioPath), 'audio.m4a was created');

    // Check SQLite state
    const dbPath = path.join(audioWorkRoot, 'work', 'database.sqlite');
    const db = new Database(dbPath, { readonly: true });

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    assert.ok(task, 'task row exists');
    assert.strictEqual(task.mode, 'audio', 'mode = audio for mp3 input');
    assert.strictEqual(task.lang, 'en', 'src lang stored');
    assert.strictEqual(task.output_lang, 'zh-CN', 'output_lang stored');
    assert.strictEqual(task.focus, 'test focus', 'focus stored');

    const steps = db.prepare('SELECT step_name, status FROM steps WHERE task_id = ?').all(taskId);
    const byName = Object.fromEntries(steps.map(s => [s.step_name, s.status]));

    assert.strictEqual(byName.fetch,   'skipped',   'fetch = skipped');
    assert.strictEqual(byName.video,   'skipped',   'video = skipped (audio file)');
    assert.strictEqual(byName.audio,   'completed', 'audio = completed');
    assert.strictEqual(byName.subs,    'failed',    'subs = failed');
    assert.strictEqual(byName.asr,     'pending',   'asr = pending');
    assert.strictEqual(byName.article, 'pending',   'article = pending');
    assert.strictEqual(byName.summary, 'pending',   'summary = pending');

    db.close();
  } finally {
    if (origWorkRoot1 === undefined) delete process.env.WORK_ROOT;
    else process.env.WORK_ROOT = origWorkRoot1;
    fs.rmSync(AUDIO_TMP, { recursive: true, force: true });
  }

  // ── Video test ──────────────────────────────────────────────────────────────
  const origWorkRoot2 = process.env.WORK_ROOT;
  const videoWorkRoot = path.join(VIDEO_TMP, 'work-root');
  process.env.WORK_ROOT = videoWorkRoot;
  try {
    const taskId = await ingestLocalFile(VIDEO_FILE);

    const expectedId = generateId('local://' + path.resolve(VIDEO_FILE));
    assert.strictEqual(taskId, expectedId, 'video task ID matches');

    const workDir = path.join(videoWorkRoot, 'work', taskId);
    assert.ok(fs.existsSync(path.join(workDir, 'media', 'video.mp4')), 'video.mp4 was created');
    assert.ok(fs.existsSync(path.join(workDir, 'media', 'audio.m4a')), 'audio.m4a was created');

    // Check SQLite state
    const dbPath = path.join(videoWorkRoot, 'work', 'database.sqlite');
    const db = new Database(dbPath, { readonly: true });

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    assert.ok(task, 'task row exists');
    assert.strictEqual(task.mode, 'media', 'mode = media for mp4 input');

    const steps = db.prepare('SELECT step_name, status FROM steps WHERE task_id = ?').all(taskId);
    const byName = Object.fromEntries(steps.map(s => [s.step_name, s.status]));

    assert.strictEqual(byName.video, 'completed', 'video = completed');
    assert.strictEqual(byName.audio, 'completed', 'audio = completed');

    db.close();
  } finally {
    if (origWorkRoot2 === undefined) delete process.env.WORK_ROOT;
    else process.env.WORK_ROOT = origWorkRoot2;
    fs.rmSync(VIDEO_TMP, { recursive: true, force: true });
  }

  console.log('ingest-integration: all assertions passed');
})().catch(err => { console.error(err); process.exit(1); });
