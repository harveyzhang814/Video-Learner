# CLI Step Progress Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `[PROGRESS]` structured line protocol so the CLI (non-TTY/agent mode) shows per-step progress — elapsed time, download percentage, and ASR phase — without SSE or new endpoints.

**Architecture:** Scripts emit `[PROGRESS] key=value` lines to stdout. For video/audio, the orchestrator converts already-parsed yt-dlp data into the same in-memory format. Orchestrator stores latest progress per step as `task.steps[stepName].progress` (in-memory only); the existing `/api/tasks/:id` polling response carries it transparently since it returns `task.steps` directly. The CLI reads progress from poll responses and prints formatted lines.

**Tech Stack:** Node.js (orchestrator, CLI), Python (ASR script), no new dependencies.

## Global Constraints
- Must develop on a `feature/*` branch — never commit to `staging` or `master` directly
- Tests use no framework: plain `node tests/<file>.test.js`
- Test suites: `npm run test:orchestrator:unit`, `npm run test:cli`
- `[PROGRESS]` lines must not interfere with `[STATUS]` line parsing in `formatStepError` (different prefix)
- `step.progress` is in-memory only — not persisted to SQLite

---

### Task 1: Orchestrator — parse `[PROGRESS]` lines, store `step.progress`

**Files:**
- Modify: `core/orchestrator/index.js`
- Test: `tests/orchestrator-progress-logging.test.js`

**Interfaces:**
- Produces: `task.steps[stepName].progress` object (plain key→string dict, cleared when step finishes)
- `[PROGRESS]` format: `[PROGRESS] key=value key=value …` — no spaces within values, no quotes

- [ ] **Step 1: Create feature branch**

```bash
git checkout staging
git checkout -b feature/cli-progress-display
```

- [ ] **Step 2: Write failing tests for `parseProgressLine`**

Append to `tests/orchestrator-progress-logging.test.js` (after the existing `run()` call at the bottom):

```js
function testParseProgressLine() {
  // Duplicate the function inline for isolated testing (not exported from orchestrator)
  function parseProgressLine(line) {
    const m = line.match(/^\[PROGRESS\]\s+(.+)$/);
    if (!m) return null;
    const pairs = {};
    for (const token of m[1].trim().split(/\s+/)) {
      const eq = token.indexOf('=');
      if (eq > 0) pairs[token.slice(0, eq)] = token.slice(eq + 1);
    }
    return Object.keys(pairs).length > 0 ? pairs : null;
  }

  // valid lines
  assert.deepStrictEqual(
    parseProgressLine('[PROGRESS] percent=45 speed=2.1MiB/s eta=01:11'),
    { percent: '45', speed: '2.1MiB/s', eta: '01:11' }
  );
  assert.deepStrictEqual(
    parseProgressLine('[PROGRESS] step=2/3 label=transcribing'),
    { step: '2/3', label: 'transcribing' }
  );
  assert.deepStrictEqual(
    parseProgressLine('[PROGRESS] step=3/3 label=writing_vtt segments=847'),
    { step: '3/3', label: 'writing_vtt', segments: '847' }
  );

  // invalid / non-PROGRESS lines
  assert.strictEqual(parseProgressLine('[STATUS] asr_start'), null);
  assert.strictEqual(parseProgressLine('[progress] downloaded=1024 total=2048 speed=512.0 eta=10'), null);
  assert.strictEqual(parseProgressLine('ordinary log line'), null);
  assert.strictEqual(parseProgressLine('[PROGRESS]'), null);          // no pairs
  assert.strictEqual(parseProgressLine('[PROGRESS] noequals'), null); // no = sign

  console.log('orchestrator-progress-logging.test.js: parseProgressLine OK');
}
testParseProgressLine();
```

- [ ] **Step 3: Run to confirm failure**

```bash
node tests/orchestrator-progress-logging.test.js
```
Expected: existing `basic parsing OK` prints, then test fails with assertion error (function not in orchestrator yet).

- [ ] **Step 4: Add `parseProgressLine` to `core/orchestrator/index.js`**

After the `parseYtDlpProgressLine` function (around line 68), add:

```js
function parseProgressLine(line) {
  const m = line.match(/^\[PROGRESS\]\s+(.+)$/);
  if (!m) return null;
  const pairs = {};
  for (const token of m[1].trim().split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq > 0) pairs[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return Object.keys(pairs).length > 0 ? pairs : null;
}
```

- [ ] **Step 5: Wire `parseProgressLine` into `handleChunkText`**

In `handleChunkText` (inside `runStep`), in the `for (const line of parts)` loop, add progress parsing after `emitJsonlRecord`:

```js
for (const line of parts) {
  emitJsonlRecord({ stream, line });
  const prog = parseProgressLine(line.trim());
  if (prog && task.steps[stepName]) {
    task.steps[stepName].progress = prog;
  }
}
```

- [ ] **Step 6: Store progress for video/audio yt-dlp output**

In the video/audio `onOutput` wrapper (the block starting `if (stepName === 'video' || stepName === 'audio')`), add progress storage after `state.lastSentPercent = percent;`:

```js
state.lastSentPercent = percent;
// Store as step.progress so CLI polling can display it
if (task.steps[stepName]) {
  task.steps[stepName].progress = {
    percent: percent != null ? String(percent) : null,
    speed:   speed > 0 ? `${formatBytesToHuman(speed)}/s` : null,
    eta:     formatEta(eta) || null,
  };
}
```

- [ ] **Step 7: Clear `step.progress` when step finishes**

In `runStep`, just before the two `emitOrchestratorEvent('step.finished', ...)` calls at the end of the function (around line 1025), add:

```js
if (task.steps[stepName]) delete task.steps[stepName].progress;
```

Also add the same line in these early-return paths inside `runStep` (search for them):
- Just before `return { success: false, error: pre.error }` (artifact validation failure, ~line 580)
- At the top of each `vtt2md`, `translate`, `md2vtt` case's abort/failed early returns (the existing `finishLogs(); return` paths)

- [ ] **Step 8: Run tests to confirm pass**

```bash
node tests/orchestrator-progress-logging.test.js
```
Expected: `basic parsing OK` and `parseProgressLine OK` both printed.

```bash
npm run test:orchestrator:unit
```
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add core/orchestrator/index.js tests/orchestrator-progress-logging.test.js
git commit -m "feat: parse [PROGRESS] lines and store step.progress in orchestrator"
```

---

### Task 2: ASR script — emit `[PROGRESS]` lines

**Files:**
- Modify: `scripts/asr_transcribe.py`

**Interfaces:**
- Produces: stdout lines `[PROGRESS] step=N/3 label=<phase>` and `[PROGRESS] step=3/3 label=writing_vtt segments=N`
- Consumed by Task 1's `parseProgressLine` (transparent — no code changes needed in Task 2 beyond the script)

- [ ] **Step 1: Update print statements in `scripts/asr_transcribe.py`**

Replace the entire `try` block body inside `main()`:

```python
media_path = find_media_file(work_dir)
os.makedirs(subs_dir, exist_ok=True)

with tempfile.NamedTemporaryFile(suffix=".wav", prefix=f"{task_id}_asr_", delete=False) as f:
    wav_path = f.name

print("[PROGRESS] step=1/3 label=extracting_audio", flush=True)
extract_audio(media_path, wav_path)

print("[PROGRESS] step=2/3 label=transcribing", flush=True)
import mlx_whisper
result = mlx_whisper.transcribe(wav_path, path_or_hf_repo=args.model, verbose=False)

segments = result.get("segments", [])
if not segments:
    print("ERROR: Whisper returned zero segments.", file=sys.stderr)
    sys.exit(1)

print(f"[PROGRESS] step=3/3 label=writing_vtt segments={len(segments)}", flush=True)
with open(vtt_path, "w", encoding="utf-8") as f:
    f.write(segments_to_vtt(segments))

print("Done.", flush=True)
```

- [ ] **Step 2: Verify format with inline check**

```bash
python3 -c "
import re
lines = [
    '[PROGRESS] step=1/3 label=extracting_audio',
    '[PROGRESS] step=2/3 label=transcribing',
    '[PROGRESS] step=3/3 label=writing_vtt segments=847',
]
for l in lines:
    m = re.match(r'^\[PROGRESS\]\s+(.+)$', l)
    assert m, f'No match: {l}'
    print('OK:', l)
"
```
Expected: three `OK:` lines.

- [ ] **Step 3: Commit**

```bash
git add scripts/asr_transcribe.py
git commit -m "feat: emit [PROGRESS] lines from asr_transcribe.py"
```

---

### Task 3: CLI — elapsed time, title, and progress display

**Files:**
- Modify: `cli/lib/format.js`
- Modify: `cli/commands/run.js`
- Test: `tests/cli-format.test.js`

**Interfaces:**
- Consumes: `step.progress` (dict) from `/api/tasks/:id` poll response (Task 1)
- Consumes: `step.started_at` / `step.completed_at` ISO strings from poll response (already returned by `getTask`)
- Produces:
  - `logStepLine(stepName, status, elapsedS)` — `elapsedS` is integer seconds or `null`
  - `logProgressLine(stepName, progress, elapsedS)` — `progress` is the `step.progress` object

- [ ] **Step 1: Write failing tests**

Append to `tests/cli-format.test.js` (after existing assertions):

```js
const { logStepLine, logProgressLine } = require('../cli/lib/format');

function capture(fn) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(s); return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return chunks.join('');
}

// logStepLine with elapsed
assert.strictEqual(
  capture(() => logStepLine('fetch', 'done', 3)),
  '[fetch_info] done (3s)\n'
);
assert.strictEqual(
  capture(() => logStepLine('fetch', 'running', null)),
  '[fetch_info] running\n'
);

// logProgressLine — download progress
assert.strictEqual(
  capture(() => logProgressLine('video', { percent: '45', speed: '2.1MiB/s', eta: '01:11' }, 23)),
  '[download_video] running (23s) — 45% 2.1MiB/s eta 01:11\n'
);

// logProgressLine — ASR phase 2 (no segments yet)
assert.strictEqual(
  capture(() => logProgressLine('asr', { step: '2/3', label: 'transcribing' }, 8)),
  '[asr_transcribe] running (8s) — step 2/3 transcribing\n'
);

// logProgressLine — ASR phase 3 with segments
assert.strictEqual(
  capture(() => logProgressLine('asr', { step: '3/3', label: 'writing_vtt', segments: '847' }, 90)),
  '[asr_transcribe] running (90s) — step 3/3 writing_vtt 847 segments\n'
);

// logProgressLine — no elapsed
assert.strictEqual(
  capture(() => logProgressLine('video', { percent: '10', speed: '1.0MiB/s', eta: '02:00' }, null)),
  '[download_video] running — 10% 1.0MiB/s eta 02:00\n'
);

console.log('cli-format: logStepLine + logProgressLine PASS');
```

- [ ] **Step 2: Run to confirm failure**

```bash
node tests/cli-format.test.js
```
Expected: existing tests pass, then `TypeError: logProgressLine is not a function`.

- [ ] **Step 3: Update `cli/lib/format.js`**

Update `logStepLine` and add `logProgressLine`:

```js
function logStepLine(stepName, status, elapsedS) {
  const elapsed = elapsedS != null ? ` (${elapsedS}s)` : '';
  process.stdout.write(`[${displayName(stepName)}] ${status}${elapsed}\n`);
}

function logProgressLine(stepName, progress, elapsedS) {
  const elapsed = elapsedS != null ? ` (${elapsedS}s)` : '';
  const parts = [];
  if (progress.percent != null) parts.push(`${progress.percent}%`);
  if (progress.speed)           parts.push(progress.speed);
  if (progress.eta)             parts.push(`eta ${progress.eta}`);
  if (progress.step)            parts.push(`step ${progress.step}`);
  if (progress.label)           parts.push(progress.label);
  if (progress.segments)        parts.push(`${progress.segments} segments`);
  process.stdout.write(`[${displayName(stepName)}] running${elapsed} — ${parts.join(' ')}\n`);
}
```

Add `logProgressLine` to `module.exports`.

- [ ] **Step 4: Run format tests**

```bash
node tests/cli-format.test.js
```
Expected: all assertions pass, prints `cli-format: logStepLine + logProgressLine PASS`.

- [ ] **Step 5: Update `cli/commands/run.js` — replace `poll` function**

Replace the entire `poll` function with:

```js
async function poll(taskId, startedAt) {
  const INTERVAL = 2000;
  const stepStatus = {};
  const stepProgress = {};   // last-printed progress JSON key per step
  let titleShown = false;

  while (true) {
    await new Promise(r => setTimeout(r, INTERVAL));
    let task;
    try { task = await client.getTask(taskId); }
    catch (err) { throw new Error(`poll failed: ${err.message}`); }

    const status = task.status;
    const steps  = task.steps || {};
    const title  = (task.meta && task.meta.title) || '';

    if (fmt.isTTY) {
      fmt.renderProgress(title || taskId, steps);
    } else {
      if (!titleShown && title) {
        process.stdout.write(`Title: ${title}\n`);
        titleShown = true;
      }

      for (const [name, info] of Object.entries(steps)) {
        if (!info) continue;

        // Status change line
        if (stepStatus[name] !== info.status) {
          stepStatus[name] = info.status;
          let elapsedS = null;
          if (info.started_at && info.completed_at) {
            elapsedS = Math.round(
              (new Date(info.completed_at) - new Date(info.started_at)) / 1000
            );
          }
          fmt.logStepLine(name, info.status, elapsedS);
        }

        // Progress line for running steps
        if (info.status === 'running' && info.progress) {
          const progKey = JSON.stringify(info.progress);
          if (stepProgress[name] !== progKey) {
            stepProgress[name] = progKey;
            const elapsedS = info.started_at
              ? Math.round((Date.now() - new Date(info.started_at)) / 1000)
              : null;
            fmt.logProgressLine(name, info.progress, elapsedS);
          }
        }
      }
    }

    if (status === 'done' || status === 'completed') {
      return { elapsed: Math.round((Date.now() - startedAt) / 1000), task };
    }

    if (status === 'failed') {
      const entries = Object.entries(steps);
      const failedEntry = entries.find(([, s]) => s && s.status === 'failed');
      const stepName = failedEntry ? fmt.displayName(failedEntry[0]) : 'unknown';
      const errMsg = failedEntry && failedEntry[1].error ? failedEntry[1].error : '';
      throw new Error(`Step ${stepName} failed${errMsg ? ': ' + errMsg : ''}`);
    }
  }
}
```

Note: added `|| status === 'completed'` — the orchestrator uses `'completed'` but existing code only checked `'done'`.

- [ ] **Step 6: Run full CLI test suite**

```bash
npm run test:cli
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add cli/lib/format.js cli/commands/run.js tests/cli-format.test.js
git commit -m "feat: show title, elapsed time, and step progress in non-TTY CLI output"
```
