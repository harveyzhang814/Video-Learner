# Mode System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `both`/`video`/`audio`/`transcript` modes with `media`/`audio`/`transcript`/`full`, where `media` (the new default) downloads video first and falls back to audio on failure.

**Architecture:** `normalizeMode()` in `schedule.js` converts old names at every entry point. `excludedByMode(mode, steps?)` becomes context-aware — in `media` mode it excludes audio until video has failed, at which point audio becomes schedulable. A one-time idempotent migration script updates the DB on HTTP server startup.

**Tech Stack:** Node.js, better-sqlite3, existing DAG scheduler, Koa HTTP server.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `core/orchestrator/schedule.js` | Modify | `normalizeMode`, updated `excludedByMode`, `secondaryChainForMode`, `pickNextStep` |
| `core/orchestrator/index.js` | Modify | `createTask`, `loadTaskFromDb`, `runStep` skip logic, `applyResetScope`, `runTask` call site |
| `scripts/migrate-mode-names.js` | Create | Idempotent DB migration: `both`/`video` → `media` |
| `services/http-server/index.js` | Modify | Run migration on startup |
| `tests/orchestrator-schedule.test.js` | Modify | Update old mode names, add `media` fallback + `full` cases |
| `tests/apply-reset-scope.test.js` | Modify | Update `both` → `media`, fix audio anchor test |
| `tests/reset-scope-all-steps-http.test.js` | Modify | Update `MODES` list and `excludedByMode` call |
| `tests/agent-http.test.js` | Modify | Add old-name normalization test |

---

## Task 1: `normalizeMode` + updated `excludedByMode` in `schedule.js`

**Files:**
- Modify: `core/orchestrator/schedule.js`
- Modify: `tests/orchestrator-schedule.test.js`

- [ ] **Step 1: Write failing tests for `normalizeMode` and new `excludedByMode`**

Add at the top of `tests/orchestrator-schedule.test.js`, after the existing imports:

```js
const { computeReadySteps, pickNextStep, getDownstreamClosure, normalizeMode, excludedByMode } = require('../core/orchestrator/schedule');
```

Replace the existing `require` line (line 4) with the above.

Add these test cases inside `run()`, before the existing cases:

```js
// normalizeMode: old names map to new names
assert.strictEqual(normalizeMode('both'), 'media');
assert.strictEqual(normalizeMode('video'), 'media');
assert.strictEqual(normalizeMode('media'), 'media');
assert.strictEqual(normalizeMode('audio'), 'audio');
assert.strictEqual(normalizeMode('transcript'), 'transcript');
assert.strictEqual(normalizeMode('full'), 'full');
assert.strictEqual(normalizeMode(''), 'media');
assert.strictEqual(normalizeMode(undefined), 'media');
assert.strictEqual(normalizeMode('garbage'), 'media');

// excludedByMode: media mode — audio excluded until video fails
{
  const noSteps = undefined;
  assert.ok(excludedByMode('media', noSteps).has('audio'), 'media: audio excluded when video not failed');
  assert.ok(!excludedByMode('media', noSteps).has('video'), 'media: video not excluded');

  const videoFailed = { video: { status: 'failed' } };
  assert.ok(!excludedByMode('media', videoFailed).has('audio'), 'media: audio allowed after video failed');

  const videoPending = { video: { status: 'pending' } };
  assert.ok(excludedByMode('media', videoPending).has('audio'), 'media: audio excluded when video pending');
}

// excludedByMode: full mode — nothing excluded
{
  assert.strictEqual(excludedByMode('full').size, 0, 'full: nothing excluded');
}

// excludedByMode: audio mode — video excluded
{
  assert.ok(excludedByMode('audio').has('video'), 'audio: video excluded');
  assert.ok(!excludedByMode('audio').has('audio'), 'audio: audio not excluded');
}

// excludedByMode: transcript mode — both excluded
{
  assert.ok(excludedByMode('transcript').has('video'), 'transcript: video excluded');
  assert.ok(excludedByMode('transcript').has('audio'), 'transcript: audio excluded');
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: fails with `normalizeMode is not a function` or similar.

- [ ] **Step 3: Implement `normalizeMode` and update `excludedByMode` in `schedule.js`**

In `core/orchestrator/schedule.js`, add `normalizeMode` before `excludedByMode` and update `excludedByMode`:

```js
/**
 * Normalise a raw mode string to a known mode value.
 * Accepts legacy names ('both', 'video') and maps them to 'media'.
 * Unknown/empty values default to 'media'.
 */
function normalizeMode(raw) {
  const m = String(raw || '').trim();
  if (m === 'both' || m === 'video' || m === 'media') return 'media';
  if (m === 'audio') return 'audio';
  if (m === 'transcript') return 'transcript';
  if (m === 'full') return 'full';
  return 'media';
}

/**
 * Steps that must never be scheduled for a given mode.
 * @param {string} mode
 * @param {object} [steps] - current task.steps (used by 'media' for dynamic audio fallback)
 * @returns {Set<string>}
 */
function excludedByMode(mode, steps) {
  const m = normalizeMode(mode);
  const ex = new Set();
  if (m === 'media') {
    // audio only becomes schedulable after video has definitively failed
    const videoFailed = steps && steps.video && steps.video.status === 'failed';
    if (!videoFailed) ex.add('audio');
  }
  if (m === 'audio') {
    ex.add('video');
  }
  if (m === 'transcript') {
    ex.add('video');
    ex.add('audio');
  }
  // 'full': nothing excluded — video and audio both run, video has higher secondary-chain priority
  return ex;
}
```

Also update `module.exports` to include `normalizeMode`:

```js
module.exports = {
  STEP_EDGES,
  ALL_STEPS,
  PREDECESSORS,
  SUCCESSORS,
  computeReadySteps,
  pickNextStep,
  getDownstreamClosure,
  excludedByMode,
  normalizeMode
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: the new assertions pass; existing assertions about `'both'` mode will now fail (they use old mode name — fixed in Task 3).

- [ ] **Step 5: Commit**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(schedule): add normalizeMode, update excludedByMode for media/full/audio/transcript"
```

---

## Task 2: Update `computeReadySteps` and `pickNextStep` to pass `steps` context

**Files:**
- Modify: `core/orchestrator/schedule.js`
- Modify: `tests/orchestrator-schedule.test.js`

- [ ] **Step 1: Write failing tests**

Add inside `run()` in `tests/orchestrator-schedule.test.js` — update the existing `'both'` cases and add new `media` fallback + `full` cases. Replace lines 33–76 (the four existing test blocks) with:

```js
// media: fetch completed → subs+video ready, audio excluded; pick subs
{
  const steps = baseSteps();
  steps.fetch = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('subs'), 'ready should contain subs');
  assert.ok(ready.has('video'), 'ready should contain video');
  assert.ok(!ready.has('audio'), 'audio must not be ready before video fails');
  assert.strictEqual(pickNextStep(ready, 'media', task.steps), 'subs');
}

// media: video failed → audio becomes ready; pick audio (no other pending secondary)
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  steps.vtt2md = completed();
  steps.md2vtt = completed();
  steps.article = completed();
  steps.summary = completed();
  steps.video = failed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('audio'), 'audio must be ready after video failed');
  assert.strictEqual(pickNextStep(ready, 'media', task.steps), 'audio');
}

// full: fetch completed → subs + video + audio all ready; pick subs (primary first)
{
  const steps = baseSteps();
  steps.fetch = completed();
  const task = { params: { mode: 'full' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('subs'), 'full: subs ready');
  assert.ok(ready.has('video'), 'full: video ready');
  assert.ok(ready.has('audio'), 'full: audio ready');
  assert.strictEqual(pickNextStep(ready, 'full', task.steps), 'subs');
}

// full: all primary done, video+audio pending → pick video before audio
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  steps.vtt2md = completed();
  steps.md2vtt = completed();
  steps.article = completed();
  steps.summary = completed();
  const task = { params: { mode: 'full' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('video'), 'full: video ready');
  assert.ok(ready.has('audio'), 'full: audio ready');
  assert.strictEqual(pickNextStep(ready, 'full', task.steps), 'video');
}

// vtt2md completed; article+md2vtt pending → pick article (main before secondary)
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  steps.vtt2md = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('article'));
  assert.ok(ready.has('md2vtt'));
  assert.strictEqual(pickNextStep(ready, 'media', task.steps), 'article');
}

// subs failed → vtt2md not ready
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = failed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(!ready.has('vtt2md'), 'vtt2md must not be ready when subs failed');
}

// video failed, fetch completed, subs pending → subs still ready
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.video = failed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('subs'), 'subs should be ready despite video failed');
}
```

- [ ] **Step 2: Run tests to verify failures**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: the new `media` fallback and `full` mode tests fail because `computeReadySteps` and `pickNextStep` don't yet pass steps.

- [ ] **Step 3: Update `secondaryChainForMode` and `pickNextStep` in `schedule.js`**

Replace `secondaryChainForMode` and `pickNextStep`:

```js
function secondaryChainForMode(mode, steps) {
  const m = normalizeMode(mode);
  return SECONDARY_CHAIN_BASE.filter((name) => !excludedByMode(m, steps).has(name));
}

/**
 * @param {Set<string>|string[]} readySet
 * @param {string} [mode]
 * @param {object} [steps] - task.steps, used for dynamic exclusion in media mode
 * @returns {string|null}
 */
function pickNextStep(readySet, mode, steps) {
  const ready =
    readySet instanceof Set ? readySet : new Set(Array.isArray(readySet) ? readySet : []);
  const m = normalizeMode(mode);

  for (const name of PRIMARY_CHAIN) {
    if (ready.has(name)) return name;
  }
  const secondary = secondaryChainForMode(m, steps);
  for (const name of secondary) {
    if (ready.has(name)) return name;
  }
  return null;
}
```

Also update `computeReadySteps` to pass `task.steps` to `excludedByMode`:

```js
function computeReadySteps(task) {
  const mode = normalizeMode((task.params && task.params.mode) || 'media');
  const excluded = excludedByMode(mode, task.steps);
  const ready = new Set();

  for (const name of ALL_STEPS) {
    if (excluded.has(name)) continue;
    const step = task.steps && task.steps[name];
    if (!step || step.status !== 'pending') continue;

    const preds = PREDECESSORS[name] || [];
    let ok = true;
    for (const p of preds) {
      if (!predecessorSatisfied(task, p)) {
        ok = false;
        break;
      }
    }
    if (ok) ready.add(name);
  }

  return ready;
}
```

- [ ] **Step 4: Run tests**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: `orchestrator-schedule.test.js: PASS`

- [ ] **Step 5: Commit**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(schedule): pass steps context through computeReadySteps/pickNextStep for media fallback"
```

---

## Task 3: Update `core/orchestrator/index.js`

**Files:**
- Modify: `core/orchestrator/index.js`

- [ ] **Step 1: Import `normalizeMode` and update `pickNextStep` call site**

At line 10, update the import from `schedule.js`:

```js
const { computeReadySteps, pickNextStep, getDownstreamClosure, excludedByMode, normalizeMode } = require('./schedule');
```

In `runTask` (around line 873), update the `pickNextStep` call to pass `task.steps`:

```js
const next = pickNextStep(ready, mode, task.steps);
```

- [ ] **Step 2: Update `createTask` — normalize mode and change default**

Find `createTask` (around line 264). Replace:

```js
const { url, focus = '', mode = 'both', force = 0, output_lang = 'zh-CN', rootDir } = params;
```

With:

```js
const { url, focus = '', mode, force = 0, output_lang = 'zh-CN', rootDir } = params;
const normalizedMode = normalizeMode(mode);
```

Then replace all uses of `mode` in `createTask` with `normalizedMode`. Specifically update line ~287 and ~299:

```js
params: { url, focus, mode: normalizedMode, force, output_lang, rootDir },
```

```js
db.updateTask(id, { url, title: '', focus, output_lang, mode: normalizedMode });
```

And the meta object (around line 275):

```js
mode: normalizedMode,
```

- [ ] **Step 3: Update `loadTaskFromDb` — normalize mode from DB**

In `loadTaskFromDb` (around line 178), find the two places that read `row.mode` and normalize both:

```js
// In params:
mode: normalizeMode(row.mode),

// In meta:
mode: normalizeMode(row.mode),
```

Also update the default fallback `|| 'both'` → remove it (normalizeMode handles empty):

```js
mode: normalizeMode(row.mode),   // was: row.mode || 'both'
```

- [ ] **Step 4: Update `runStep` mode-skip logic**

Find the mode-skip block (around line 454). Replace:

```js
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
```

With:

```js
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
```

- [ ] **Step 5: Update `applyResetScope` — pass `task.steps` to `excludedByMode`**

Find `applyResetScope` (around line 799):

```js
const mode = (task.params && task.params.mode) || 'both';
if (excludedByMode(mode).has(stepName)) {
```

Replace with:

```js
const mode = (task.params && task.params.mode) || 'media';
if (excludedByMode(mode, task.steps).has(stepName)) {
```

- [ ] **Step 6: Run all orchestrator unit tests**

```bash
npm run test:orchestrator:unit
```

Expected: some tests fail (they still use old mode names `'both'`). Those are fixed in Task 5.

- [ ] **Step 7: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): normalizeMode in createTask/loadTaskFromDb, update runStep/applyResetScope for new modes"
```

---

## Task 4: DB migration script

**Files:**
- Create: `scripts/migrate-mode-names.js`
- Modify: `services/http-server/index.js`

- [ ] **Step 1: Create migration script**

Create `scripts/migrate-mode-names.js`:

```js
'use strict';

/**
 * Idempotent migration: rename legacy mode values 'both' and 'video' → 'media'.
 * Safe to run multiple times.
 *
 * Usage:
 *   node scripts/migrate-mode-names.js [rootDir]
 *   (rootDir defaults to <project-root>/work)
 */

const path = require('path');
const Database = require('better-sqlite3');

function migrateModeName(rootDir) {
  const dbPath = path.join(rootDir, 'database.sqlite');
  // Return silently if DB doesn't exist yet (fresh install).
  const fs = require('fs');
  if (!fs.existsSync(dbPath)) return 0;

  const db = new Database(dbPath);
  const result = db
    .prepare("UPDATE tasks SET mode = 'media' WHERE mode IN ('both', 'video')")
    .run();
  db.close();
  return result.changes;
}

module.exports = { migrateModeName };

if (require.main === module) {
  const rootDir = process.argv[2] || path.join(__dirname, '..', 'work');
  const n = migrateModeName(rootDir);
  console.log(`migrate-mode-names: updated ${n} task(s).`);
}
```

- [ ] **Step 2: Wire migration into HTTP server startup**

In `services/http-server/index.js`, add the import near the top (after existing requires):

```js
const { migrateModeName } = require('../../scripts/migrate-mode-names');
```

Inside `createApp(options = {})`, add the migration call right after `const ROOT_DIR = ...` line (around line 22):

```js
const ROOT_DIR = options.rootDir ?? path.resolve(__dirname, '../..');
// Run once on startup — idempotent, no-op if DB doesn't exist yet.
migrateModeName(ROOT_DIR);
```

- [ ] **Step 3: Verify migration runs without error**

```bash
node -e "const {createApp} = require('./services/http-server'); createApp({ rootDir: '/tmp/vl-test-migrate' }); console.log('OK');"
```

Expected: `OK` (no crash, no output from migration since DB doesn't exist in temp dir).

- [ ] **Step 4: Test migration with a real DB**

```bash
node -e "
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-migrate-'));
// Create a minimal DB with legacy mode rows
const db = new Database(path.join(tmp, 'database.sqlite'));
db.exec(\"CREATE TABLE tasks (id TEXT, url TEXT, mode TEXT);\");
db.prepare(\"INSERT INTO tasks VALUES ('t1','u1','both'),('t2','u2','video'),('t3','u3','audio')\").run();
db.close();
// Run migration
const {migrateModeName} = require('./scripts/migrate-mode-names');
const n = migrateModeName(tmp);
console.log('changed:', n); // expect 2
// Verify
const db2 = new Database(path.join(tmp, 'database.sqlite'));
const rows = db2.prepare('SELECT id, mode FROM tasks ORDER BY id').all();
console.log(rows);
// expect: t1=media, t2=media, t3=audio
db2.close();
"
```

Expected output:
```
changed: 2
[ { id: 't1', mode: 'media' }, { id: 't2', mode: 'media' }, { id: 't3', mode: 'audio' } ]
```

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-mode-names.js services/http-server/index.js
git commit -m "feat: add migrate-mode-names script, run on HTTP server startup"
```

---

## Task 5: Fix existing tests

**Files:**
- Modify: `tests/apply-reset-scope.test.js`
- Modify: `tests/reset-scope-all-steps-http.test.js`
- Modify: `tests/agent-http.test.js`

- [ ] **Step 1: Fix `apply-reset-scope.test.js`**

Line 16: change `mode: 'both'` → `mode: 'media'`:

```js
const { task_id: taskId } = await orchestrator.createTask({
  url: 'https://example.com/watch?v=apply-rscope',
  focus: '',
  mode: 'media',
  force: 0,
  output_lang: 'zh-CN',
  rootDir: tmp
});
```

Lines 23–28 — the audio `BAD_ANCHOR_MODE` test: in `media` mode with video **not** failed, audio is still excluded. The existing assertion is still correct. No change needed there.

Add a new test after line 28 that verifies audio IS allowed after video fails:

```js
// media mode: after video fails, audio is a valid reset anchor
{
  const db2 = require('../core/orchestrator/db').createDb(tmp);
  db2.writeStepState(id, 'video', { status: 'failed', attempts: 1, error: 'test' });
  orchestrator._dropTaskFromMemory(id);
  await orchestrator.getTask(id, { rootDir: tmp });
  // Now audio should be a valid anchor (video failed)
  const r = orchestrator.applyResetScope(id, 'audio', 'step', { rootDir: tmp });
  assert.ok(r.reset_steps.includes('audio'), 'audio should be resettable after video fails');
  // Reset video back to pending for remaining tests
  db2.writeStepState(id, 'video', { status: 'pending', attempts: 0, error: null });
  orchestrator._dropTaskFromMemory(id);
  await orchestrator.getTask(id, { rootDir: tmp });
}
```

- [ ] **Step 2: Fix `reset-scope-all-steps-http.test.js`**

Line 19: update `MODES` and the `excludedByMode` call to pass steps:

```js
const MODES = ['transcript', 'media', 'audio', 'full'];
```

Line 91: `excludedByMode(mode)` is called without steps to build expected exclusions. This is correct for the test scenario where all steps are `pending` (no video failure yet). No change needed to line 91.

- [ ] **Step 3: Add old-name compatibility test in `agent-http.test.js`**

Find the existing POST /api/tasks test. After it, add (look for a place near the task creation test, around the `// create task` comment):

```js
// old mode names are silently normalized
{
  const res = await jsonRequest(base, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mode: 'both' })
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.meta.mode, 'media', 'both → media normalization');
}
{
  const res = await jsonRequest(base, '/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ2', mode: 'video' })
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.meta.mode, 'media', 'video → media normalization');
}
```

- [ ] **Step 4: Run all tests**

```bash
npm run test:orchestrator:unit && npm run test:agent:core
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/apply-reset-scope.test.js tests/reset-scope-all-steps-http.test.js tests/agent-http.test.js
git commit -m "test: update mode names both→media, add media fallback and old-name normalization tests"
```

---

## Task 6: Update docs/pending TODO

**Files:**
- Modify: `docs/pending/2026-04-13-audio-fallback-in-both-mode.md`

- [ ] **Step 1: Mark TODO as resolved**

Replace the file content with:

```markdown
# ~~TODO: audio fallback when video fails in `both` mode~~

**Resolved** in mode redesign (2026-04-13).

`both` and `video` modes were replaced with `media` (video-first with audio fallback).
In `media` mode, the `audio` step automatically becomes schedulable after `video` fails.
See `docs/superpowers/specs/2026-04-13-mode-redesign.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/pending/2026-04-13-audio-fallback-in-both-mode.md
git commit -m "docs: mark audio-fallback TODO as resolved by mode redesign"
```

---

## Self-Review

**Spec coverage check:**
- ✅ `normalizeMode` — Task 1
- ✅ `excludedByMode(mode, steps?)` dynamic audio in `media` — Tasks 1–2
- ✅ `full` mode scheduling (both media steps) — Task 2
- ✅ `computeReadySteps` passes steps — Task 2
- ✅ `pickNextStep` passes steps — Task 2
- ✅ `createTask` normalizes mode — Task 3
- ✅ `loadTaskFromDb` normalizes mode — Task 3
- ✅ `runStep` skip logic — Task 3
- ✅ `applyResetScope` passes steps — Task 3
- ✅ DB migration script — Task 4
- ✅ HTTP server startup migration — Task 4
- ✅ Old names accepted silently — Task 3 + Task 5
- ✅ Tests updated — Tasks 1, 2, 5

**Placeholder scan:** No TBDs, all code blocks complete.

**Type consistency:**
- `normalizeMode` defined in Task 1, imported in Task 3 — consistent.
- `excludedByMode(mode, steps?)` — second param optional throughout.
- `pickNextStep(readySet, mode, steps)` — third param added in Task 2, used in Task 3.
- `migrateModeName(rootDir)` — defined in Task 4, called in Task 4 Step 2.
