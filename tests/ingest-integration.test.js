'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const Database = require('better-sqlite3');
const { ingestLocalFile } = require('../cli/lib/ingest');
const { generateId } = require('../core/id');
const { getDbPath, getWorkRoot } = require('../core/paths');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-ingest-test-'));
const AUDIO_FILE = path.join(TMP, 'test.mp3');

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

// Save and override WORK_ROOT so we don't pollute the real work dir
const origWorkRoot = process.env.WORK_ROOT;
const testWorkRoot = path.join(TMP, 'work-root');
process.env.WORK_ROOT = testWorkRoot;

(async () => {
  try {
    const taskId = await ingestLocalFile(AUDIO_FILE, {
      focus: 'test focus',
      srcLang: 'en',
      outputLang: 'zh-CN',
    });

    const expectedId = generateId(`local://${AUDIO_FILE}`);
    assert.strictEqual(taskId, expectedId, 'task ID matches');

    // audio.m4a must exist
    const workDir = path.join(testWorkRoot, 'work', taskId);
    const audioPath = path.join(workDir, 'media', 'audio.m4a');
    assert.ok(fs.existsSync(audioPath), 'audio.m4a was created');

    // Check SQLite state
    const dbPath = path.join(testWorkRoot, 'work', 'database.sqlite');
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
    console.log('ingest-integration: all assertions passed');
  } finally {
    if (origWorkRoot === undefined) delete process.env.WORK_ROOT;
    else process.env.WORK_ROOT = origWorkRoot;
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exit(1); });
