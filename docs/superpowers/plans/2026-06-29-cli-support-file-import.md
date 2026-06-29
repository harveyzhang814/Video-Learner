# CLI Local File Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `vdl <file>` to accept local audio/video files and run them through the same ASR → translate → article → summary pipeline as YouTube URLs.

**Architecture:** A new `cli/lib/ingest.js` module handles file-type detection, ffmpeg conversion, and direct SQLite seeding. `cli/commands/run.js` branches on local vs. URL input after parsing args; once the DB is seeded the normal server-start + `runStep` + `poll` flow takes over. `cli/index.js` routing is extended to also dispatch local paths to `run.js`.

**Tech Stack:** Node.js, better-sqlite3, ffmpeg (system binary), child_process.execSync

## Global Constraints

- Never kill a running server — seed SQLite *before* calling `server.ensureServer()` so the server loads fresh state from DB on first request
- `--src-lang` is the CLI flag name; stored as `lang` in the tasks table (same column the bash script sets as `$SRC_LANG`)
- Task ID is always `generateId('local://<absPath>')` — deterministic, re-running the same file reuses the same task row
- Mode auto-determination: audio file → `audio`; video file → `media`; overridden only when user explicitly passes `--mode`
- ffmpeg must be on `$PATH`; if not found, `execSync` throws naturally with a descriptive error

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `cli/lib/ingest.js` | File detection, ffmpeg conversion, SQLite seeding, exports `ingestLocalFile` + `isLocalPath` + `detectFileType` |
| Modify | `cli/commands/run.js` | Add `--src-lang` + `modeExplicit` to `parseArgs`; add local-file branch in `run()` |
| Modify | `cli/index.js` | Extend routing to dispatch local paths to `run.js` |
| Modify | `docs/reference/cli.md` | Document `vdl <file>` usage and `--src-lang` |
| Create | `tests/ingest-unit.test.js` | Unit tests for `isLocalPath` and `detectFileType` |
| Create | `tests/ingest-integration.test.js` | Integration test: generate tiny audio with ffmpeg → ingest → verify DB state |

---

## Task 1: `cli/lib/ingest.js` — core ingest logic

**Files:**
- Create: `cli/lib/ingest.js`
- Test: `tests/ingest-unit.test.js`

**Interfaces:**
- Produces:
  - `isLocalPath(s: string): boolean` — true if `s` starts with `/`, `./`, or `../`
  - `detectFileType(filePath: string): 'audio' | 'video' | null` — by extension, case-insensitive
  - `ingestLocalFile(filePath: string, opts?: IngestOpts): Promise<string>` — returns `taskId`
  - `IngestOpts = { focus?: string, srcLang?: string, outputLang?: string, mode?: string|null, timeoutScale?: number }`

- [ ] **Step 1: Write failing unit tests**

Create `tests/ingest-unit.test.js`:

```js
'use strict';
const assert = require('assert');
const { isLocalPath, detectFileType } = require('../cli/lib/ingest');

// isLocalPath
assert.strictEqual(isLocalPath('/abs/path.mp3'), true,  'absolute path');
assert.strictEqual(isLocalPath('./rel/path.mp3'), true,  'relative ./');
assert.strictEqual(isLocalPath('../up/path.mp3'), true,  'relative ../');
assert.strictEqual(isLocalPath('https://youtube.com'), false, 'url');
assert.strictEqual(isLocalPath('rerun'), false, 'subcommand');
assert.strictEqual(isLocalPath('--focus'),  false, 'flag');

// detectFileType — audio
for (const ext of ['mp3','m4a','wav','aac','flac','ogg','opus']) {
  assert.strictEqual(detectFileType(`/f.${ext}`), 'audio', ext);
  assert.strictEqual(detectFileType(`/f.${ext.toUpperCase()}`), 'audio', `${ext} uppercase`);
}

// detectFileType — video
for (const ext of ['mp4','mkv','mov','avi','webm','ts','m4v']) {
  assert.strictEqual(detectFileType(`/f.${ext}`), 'video', ext);
}

// detectFileType — unknown
assert.strictEqual(detectFileType('/f.txt'),  null, 'txt');
assert.strictEqual(detectFileType('/f.pdf'),  null, 'pdf');
assert.strictEqual(detectFileType('/f'),      null, 'no ext');

console.log('ingest-unit: all assertions passed');
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node tests/ingest-unit.test.js
```

Expected: `Error: Cannot find module '../cli/lib/ingest'`

- [ ] **Step 3: Implement `cli/lib/ingest.js`**

```js
'use strict';
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { generateId } = require('../../core/id');
const { getWorkRoot, getDbPath, getTaskDirs } = require('../../core/paths');
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

  const db = createDb(projectRoot);
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
```

- [ ] **Step 4: Run unit tests — verify they pass**

```bash
node tests/ingest-unit.test.js
```

Expected: `ingest-unit: all assertions passed`

- [ ] **Step 5: Write integration test**

Create `tests/ingest-integration.test.js`:

```js
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
```

- [ ] **Step 6: Run integration test — verify it passes**

```bash
node tests/ingest-integration.test.js
```

Expected: `ingest-integration: all assertions passed`

- [ ] **Step 7: Commit**

```bash
git add cli/lib/ingest.js tests/ingest-unit.test.js tests/ingest-integration.test.js
git commit -m "feat: add cli/lib/ingest.js — local file detection and SQLite seeding"
```

---

## Task 2: Wire local-file path into `run.js` and `index.js`

**Files:**
- Modify: `cli/commands/run.js` (lines 10–34, 87–89)
- Modify: `cli/index.js` (line 60)

**Interfaces:**
- Consumes: `ingestLocalFile`, `isLocalPath` from `../lib/ingest`
- Consumes: `client.runStep(taskId, 'asr', { reset_scope: 'downstream' })` — already used by `rerun.js`
- `parseArgs` now also returns `{ filePath: string|null, srcLang: string, modeExplicit: boolean }`

- [ ] **Step 1: Update `parseArgs` in `cli/commands/run.js`**

Replace lines 10–34 with:

```js
function parseArgs(args) {
  const opts = {
    url: null, filePath: null, focus: '', mode: 'media', modeExplicit: false,
    srcLang: 'en', lang: 'zh-CN',
    force: false, json: false, timeout_scale: 1, workRoot: null,
  };
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--focus')            { opts.focus  = args[++i]; }
    else if (a === '--mode')        { opts.mode   = args[++i]; opts.modeExplicit = true; }
    else if (a === '--lang')        { opts.lang   = args[++i]; }
    else if (a === '--src-lang')    { opts.srcLang = args[++i]; }
    else if (a === '--force')       { opts.force  = true; }
    else if (a === '--json')        { opts.json   = true; }
    else if (a === '--long')        { opts.timeout_scale = 3; }
    else if (a === '--ultra-long')  { opts.timeout_scale = 6; }
    else if (a === '--timeout-scale') {
      const n = Number(args[++i]);
      if (Number.isFinite(n) && n > 0) opts.timeout_scale = n;
    }
    else if (a === '--work-root')   { opts.workRoot = args[++i]; }
    else if (!opts.url && a.startsWith('http')) { opts.url = a; }
    else if (!opts.filePath && (a.startsWith('/') || a.startsWith('./') || a.startsWith('../'))) {
      opts.filePath = a;
    }
    i++;
  }
  return opts;
}
```

- [ ] **Step 2: Add local-file branch in `run()` in `cli/commands/run.js`**

Replace the beginning of `async function run(args)` (lines 87–112). The full new `run` function:

```js
async function run(args) {
  const opts = parseArgs(args);

  if (!opts.url && !opts.filePath) {
    fmt.printError('URL or local file required. Usage: vdl <url|file> [options]');
    process.exit(1);
  }

  if (opts.workRoot) process.env.WORK_ROOT = opts.workRoot;

  if (!opts.focus) opts.focus = await askFocus();

  // ── Local file path ──────────────────────────────────────────────────────
  if (opts.filePath) {
    const { ingestLocalFile } = require('../lib/ingest');
    let taskId;
    try {
      taskId = await ingestLocalFile(opts.filePath, {
        focus: opts.focus,
        srcLang: opts.srcLang,
        outputLang: opts.lang,
        mode: opts.modeExplicit ? opts.mode : null,
        timeoutScale: opts.timeout_scale,
      });
    } catch (err) {
      fmt.printError(err.message);
      process.exit(1);
    }

    process.stdout.write(`Task: ${taskId}\n`);

    const token = await server.ensureServer();
    server.registerShutdown();
    client.init('http://127.0.0.1:3000', token);

    const r = await client.runStep(taskId, 'asr', { reset_scope: 'downstream' });
    if (r && r.status === 409) {
      fmt.printError('Task is currently running. Wait for it to finish.');
      process.exit(1);
    }

    const startedAt = Date.now();
    const { elapsed } = await poll(taskId, startedAt);

    const workDir = path.join(getWorkRoot(path.resolve(__dirname, '../..')), taskId);
    const paths = {
      transcript: `${workDir}/transcript/original.md`,
      article:    `${workDir}/writing/article.md`,
      summary:    `${workDir}/writing/summary.md`,
    };
    if (opts.json) {
      process.stdout.write(JSON.stringify({ task_id: taskId, elapsed, ...paths }) + '\n');
    } else {
      fmt.printDone(elapsed, paths);
    }
    return;
  }

  // ── YouTube / remote URL ─────────────────────────────────────────────────
  const token = await server.ensureServer();
  server.registerShutdown();
  client.init('http://127.0.0.1:3000', token);

  const taskId = await client.createTask({
    url: opts.url,
    focus: opts.focus,
    mode: opts.mode,
    output_lang: opts.lang,
    force: opts.force,
    timeout_scale: opts.timeout_scale,
  });

  process.stdout.write(`Task: ${taskId}\n`);

  const startedAt = Date.now();
  const { elapsed } = await poll(taskId, startedAt);

  const workDir = path.join(getWorkRoot(path.resolve(__dirname, '../..')), taskId);
  const paths = {
    transcript: `${workDir}/transcript/original.md`,
    article:    `${workDir}/writing/article.md`,
    summary:    `${workDir}/writing/summary.md`,
  };
  if (opts.json) {
    process.stdout.write(JSON.stringify({ task_id: taskId, elapsed, ...paths }) + '\n');
  } else {
    fmt.printDone(elapsed, paths);
  }
}
```

- [ ] **Step 3: Extend routing in `cli/index.js`**

On line 60, replace:

```js
  } else if (sub.startsWith('http') || sub.startsWith('-')) {
```

with:

```js
  } else if (sub.startsWith('http') || sub.startsWith('-') ||
             sub.startsWith('/') || sub.startsWith('./') || sub.startsWith('../')) {
```

- [ ] **Step 4: Update `printUsage` in `cli/index.js`**

Replace the `vdl <url>` line in the usage string with:

```js
  vdl <url|file> [--focus <text>] [--mode transcript|media|audio|full]
                 [--lang zh-CN|en] [--src-lang zh|en|ja|…]
                 [--force] [--json]
                 [--long] [--ultra-long] [--timeout-scale <n>]
                 [--work-root <path>]

  --src-lang        源语言 (Whisper hint)，默认 en；本地文件时有效
```

- [ ] **Step 5: Run existing CLI tests — verify nothing broke**

```bash
npm run test:cli
```

Expected: all tests pass (no changes to URL flow behaviour)

- [ ] **Step 6: Commit**

```bash
git add cli/commands/run.js cli/index.js
git commit -m "feat: extend vdl CLI to accept local audio/video files via ingestLocalFile"
```

---

## Task 3: Docs

**Files:**
- Modify: `docs/reference/cli.md`

- [ ] **Step 1: Update the main command table in `docs/reference/cli.md`**

In the `### vdl <url> [options]` section, change the heading and add the new row to the options table:

Heading becomes:
```markdown
### `vdl <url|file> [options]` — 主命令
```

Add row to the options table (after `--work-root`):

```markdown
| `--src-lang <lang>` | `en` | 源语言（Whisper hint）；本地文件导入时有效，如 `zh`、`en`、`ja` |
```

- [ ] **Step 2: Add a "本地文件导入" section after the main command section**

Insert after the main command table, before `### vdl status`:

```markdown
#### 本地文件导入

`vdl` 可直接接受本地音频或视频文件路径，绕过 YouTube 下载步骤，从 ASR 阶段开始运行：

```bash
# 音频文件（mp3 / m4a / wav / aac / flac / ogg / opus）
vdl ./meeting.mp3 --src-lang zh --focus "核心议题"
vdl /recordings/lecture.m4a --src-lang en --lang zh-CN --long

# 视频文件（mp4 / mkv / mov / avi / webm / ts / m4v）
vdl ./screen.mov --src-lang en
vdl /videos/conf.mp4 --mode audio   # 仅生成文字，不保留视频文件
```

| 输入类型 | 自动 mode | fetch / video / subs | audio |
|---------|----------|---------------------|-------|
| 音频文件 | `audio`  | skipped / skipped / failed | completed（直接复制/转码） |
| 视频文件 | `media`  | skipped / completed / failed | completed（从视频提取音轨） |

`--mode audio` 可在传入视频文件时强制跳过视频保存，仅提取音轨。
```

- [ ] **Step 3: Commit**

```bash
git add docs/reference/cli.md
git commit -m "docs: document local file import for vdl CLI"
```

---

## Self-Review

**Spec coverage:**
- ✓ Local audio files: copy/convert to `audio.m4a`, mode=audio, video=skipped
- ✓ Local video files: extract audio + copy video, mode=media, video=completed
- ✓ `--src-lang` option added
- ✓ `--mode` override respected (e.g., `--mode audio` on video skips video copy)
- ✓ Task ID deterministic from `local://<absPath>`
- ✓ Server not killed — seeding happens before `ensureServer()`
- ✓ Existing URL flow untouched
- ✓ Integration test verifies DB step states
- ✓ CLI routing in `index.js` updated
- ✓ Docs updated

**Placeholder scan:** None found — all steps include code.

**Type consistency:**
- `isLocalPath` used inline in `run.js` (duplicated string checks) and exported from `ingest.js` for tests — consistent
- `ingestLocalFile` returns `string` (taskId) in Task 1, consumed in Task 2 as `taskId` — consistent
- `modeOverride = null` default in `ingestLocalFile`, `null` passed from `run.js` when `!opts.modeExplicit` — consistent
