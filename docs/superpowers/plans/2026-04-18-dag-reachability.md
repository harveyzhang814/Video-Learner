# DAG Reachability-Based Failure Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two hardcoded OR-gate checks and the `isContentStepFailure`/`CONTENT_STEPS` helpers with a single data-driven DAG reachability algorithm.

**Architecture:** Add `GATE_TYPE`, `TERMINAL_NODE`, `CRITICAL_PATH` constants and three pure functions (`isNodeReachable`, `isTaskFailed`, `isTaskCompleted`) to `schedule.js`. Generalize `computeReadySteps` to use `GATE_TYPE` instead of a hardcoded `vtt2md` special case. Remove `CONTENT_STEPS` and `isContentStepFailure` from `index.js`, replacing all three call sites with `isTaskFailed` / `isTaskCompleted`.

**Tech Stack:** Node.js, plain `assert`-based tests (no framework), `node tests/orchestrator-schedule.test.js`

---

## File Structure

| File | Change |
|------|--------|
| `core/orchestrator/schedule.js` | Add 3 constants + 3 functions; update `computeReadySteps`; update `module.exports` |
| `core/orchestrator/index.js` | Remove `CONTENT_STEPS`, `isContentStepFailure`; add imports; update 3 call sites |
| `tests/orchestrator-schedule.test.js` | Add 14 new assertions inside the existing `run()` function |

---

### Task 1: Add `GATE_TYPE`/`TERMINAL_NODE`/`CRITICAL_PATH` constants and `isNodeReachable`

**Files:**
- Modify: `core/orchestrator/schedule.js` (after line 51, before `getDownstreamClosure`)
- Modify: `tests/orchestrator-schedule.test.js` (add assertions before the final `console.log`)

- [ ] **Step 1: Write the failing tests**

Open `tests/orchestrator-schedule.test.js`. Add the following block immediately before the final `console.log('orchestrator-schedule.test.js: PASS')` line:

```javascript
// isNodeReachable: not yet exported — will fail with "isNodeReachable is not a function"
{
  const { isNodeReachable } = require('../core/orchestrator/schedule');

  function skipped() { return { status: 'skipped', attempts: 0, error: null }; }
  function running() { return { status: 'running',  attempts: 1, error: null }; }

  // Root node: fetch=pending, no predecessors → reachable
  {
    const steps = baseSteps();
    assert.strictEqual(isNodeReachable('fetch', steps, 'media', new Set()), true,
      'fetch pending: reachable (root node)');
  }

  // fetch=failed → not reachable
  {
    const steps = baseSteps();
    steps.fetch = failed();
    assert.strictEqual(isNodeReachable('fetch', steps, 'media', new Set()), false,
      'fetch failed: not reachable');
  }

  // fetch=completed → reachable immediately
  {
    const steps = baseSteps();
    steps.fetch = completed();
    assert.strictEqual(isNodeReachable('fetch', steps, 'media', new Set()), true,
      'fetch completed: reachable');
  }

  // subs: fetch=completed, subs=pending → reachable
  {
    const steps = baseSteps();
    steps.fetch = completed();
    assert.strictEqual(isNodeReachable('subs', steps, 'media', new Set()), true,
      'subs pending + fetch completed: reachable');
  }

  // subs: fetch=failed, subs=pending → not reachable (predecessor failed)
  {
    const steps = baseSteps();
    steps.fetch = failed();
    assert.strictEqual(isNodeReachable('subs', steps, 'media', new Set()), false,
      'subs pending + fetch failed: not reachable');
  }

  // vtt2md OR gate: subs=completed, asr=pending → reachable (subs satisfies OR)
  {
    const steps = baseSteps();
    steps.fetch = completed();
    steps.subs = completed();
    assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), true,
      'vtt2md: subs=completed satisfies OR gate');
  }

  // vtt2md OR gate: subs=failed, asr=completed → reachable (asr satisfies OR)
  {
    const steps = baseSteps();
    steps.fetch = completed();
    steps.subs = failed();
    steps.asr = completed();
    assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), true,
      'vtt2md: asr=completed satisfies OR gate');
  }

  // vtt2md OR gate: subs=failed, asr=failed → not reachable
  {
    const steps = baseSteps();
    steps.fetch = completed();
    steps.subs = failed();
    steps.asr = failed();
    assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), false,
      'vtt2md: both subs and asr failed → not reachable');
  }

  // KEY: transcript mode, subs=failed, asr=pending+excluded → NOT reachable
  // (asr is excluded in transcript mode and is still pending → won't produce VTT files)
  {
    const steps = baseSteps();
    steps.fetch = completed();
    steps.subs = failed();
    // asr stays pending; transcript mode excludes it
    assert.strictEqual(isNodeReachable('vtt2md', steps, 'transcript', new Set()), false,
      'vtt2md: transcript mode, subs=failed, asr=excluded+pending → not reachable');
  }

  // media mode, subs=failed, asr=pending+not-yet-excluded (video not completed yet) → not reachable
  // (asr is excluded when subs not failed AND when video not completed in media mode)
  // subs=failed triggers asr eligibility check; video=pending means asr is still excluded
  {
    const steps = baseSteps();
    steps.fetch = completed();
    steps.subs = failed();
    steps.video = pending(); // asr excluded: subs failed but video not completed
    assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), false,
      'vtt2md: media mode, subs=failed, asr excluded (video pending) → not reachable');
  }

  // media mode, subs=failed, asr=pending, video=completed → asr runnable → vtt2md reachable
  {
    const steps = baseSteps();
    steps.fetch = completed();
    steps.subs = failed();
    steps.video = completed();
    // asr is not excluded (subs failed + video completed)
    assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), true,
      'vtt2md: media mode, subs=failed, video=completed → asr runnable → reachable');
  }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: `TypeError: isNodeReachable is not a function` (or similar import error).

- [ ] **Step 3: Add constants and implement `isNodeReachable` in `schedule.js`**

Open `core/orchestrator/schedule.js`. After the `SUCCESSORS` block (after line 51), insert:

```javascript
/**
 * Gate type per node. Omitted nodes default to AND.
 * AND: all predecessors must be completed/skipped.
 * OR:  at least one predecessor that can produce output must be reachable.
 */
const GATE_TYPE = {
  vtt2md: 'OR'
};

/** The single terminal node whose reachability determines task failure. */
const TERMINAL_NODE = 'summary';

/**
 * Nodes that must all be completed/skipped for isTaskCompleted.
 * Excludes side-branch steps (md2vtt) not required for summary output.
 */
const CRITICAL_PATH = ['fetch', 'vtt2md', 'article', 'summary'];

/**
 * Returns true if `node` can still reach completed or skipped state.
 *
 * OR gate semantics: a mode-excluded or skipped predecessor does NOT satisfy
 * the OR gate — it will never produce the required output (e.g. VTT files).
 * Only a completed predecessor, or a pending+runnable predecessor whose own
 * predecessors are reachable, satisfies an OR gate.
 *
 * @param {string} node
 * @param {object} steps  - task.steps map
 * @param {string} mode   - normalised mode string
 * @param {Set<string>} visited - cycle guard; pass new Set() from callers
 * @returns {boolean}
 */
function isNodeReachable(node, steps, mode, visited) {
  if (!visited) visited = new Set();
  if (visited.has(node)) return false; // cycle guard (DAG is acyclic; defensive)

  const status = (steps[node] && steps[node].status) || 'pending';
  if (status === 'completed' || status === 'skipped') return true;
  if (status === 'failed') return false;

  // pending / running: check mode exclusion first
  if (excludedByMode(mode, steps).has(node)) return false; // won't produce output

  // pending / running + not excluded: recurse into predecessors
  const nextVisited = new Set(visited);
  nextVisited.add(node);
  const preds = PREDECESSORS[node] || [];
  if (preds.length === 0) return true; // root node (fetch)

  if (GATE_TYPE[node] === 'OR') {
    // OR gate: need at least one predecessor that can actually produce output.
    return preds.some(function(p) {
      const ps = (steps[p] && steps[p].status) || 'pending';
      if (ps === 'completed') return true;                     // produced output
      if (ps === 'skipped') return false;                      // no output produced
      if (excludedByMode(mode, steps).has(p)) return false;   // will never produce output
      return isNodeReachable(p, steps, mode, new Set(nextVisited)); // path-local visited
    });
  }
  // AND gate: every predecessor must be reachable (path-local visited per branch)
  return preds.every(function(p) {
    return isNodeReachable(p, steps, mode, new Set(nextVisited));
  });
}
```

- [ ] **Step 4: Export `isNodeReachable` and the three constants**

In `module.exports` at the bottom of `schedule.js`, add the new names:

```javascript
module.exports = {
  STEP_EDGES,
  ALL_STEPS,
  PREDECESSORS,
  SUCCESSORS,
  GATE_TYPE,
  TERMINAL_NODE,
  CRITICAL_PATH,
  computeReadySteps,
  pickNextStep,
  getDownstreamClosure,
  excludedByMode,
  normalizeMode,
  isNodeReachable
};
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: `orchestrator-schedule.test.js: PASS`

- [ ] **Step 6: Commit**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(schedule): add GATE_TYPE/TERMINAL_NODE/CRITICAL_PATH and isNodeReachable"
```

---

### Task 2: Add `isTaskFailed` and `isTaskCompleted`

**Files:**
- Modify: `core/orchestrator/schedule.js` (add two functions after `isNodeReachable`)
- Modify: `tests/orchestrator-schedule.test.js` (add assertions inside the existing `isNodeReachable` block)

- [ ] **Step 1: Write the failing tests**

In `tests/orchestrator-schedule.test.js`, inside the same block from Task 1 (after the last `isNodeReachable` assertion), append:

```javascript
  // isTaskFailed / isTaskCompleted
  const { isTaskFailed, isTaskCompleted } = require('../core/orchestrator/schedule');

  function makeTask(mode, stepsOverride) {
    const steps = Object.assign(baseSteps(), stepsOverride || {});
    return { params: { mode: mode || 'media' }, steps };
  }

  // subs=completed → not failed
  assert.strictEqual(isTaskFailed(makeTask('media', {
    fetch: completed(), subs: completed(), vtt2md: completed(), article: completed(), summary: completed()
  })), false, 'isTaskFailed: all completed → false');

  // subs=failed + asr=completed → not failed (fallback path succeeded)
  assert.strictEqual(isTaskFailed(makeTask('media', {
    fetch: completed(), subs: failed(), asr: completed(),
    vtt2md: completed(), article: completed(), summary: completed()
  })), false, 'isTaskFailed: subs=failed, asr=completed → false');

  // subs=failed + asr=failed → failed
  assert.strictEqual(isTaskFailed(makeTask('media', {
    fetch: completed(), subs: failed(), asr: failed()
  })), true, 'isTaskFailed: subs=failed, asr=failed → true');

  // transcript mode: subs=failed, asr=excluded+pending → failed (core correctness test)
  assert.strictEqual(isTaskFailed(makeTask('transcript', {
    fetch: completed(), subs: failed()
    // asr stays pending; transcript mode excludes it
  })), true, 'isTaskFailed: transcript, subs=failed, asr=excluded+pending → true');

  // md2vtt=failed, all others ok → NOT failed (md2vtt is a side branch)
  assert.strictEqual(isTaskFailed(makeTask('media', {
    fetch: completed(), subs: completed(), vtt2md: completed(),
    md2vtt: failed(), article: completed(), summary: completed()
  })), false, 'isTaskFailed: md2vtt=failed → false (side branch, not critical)');

  // isTaskCompleted: all critical path done, subs completed → true
  assert.strictEqual(isTaskCompleted(makeTask('media', {
    fetch: completed(), subs: completed(), vtt2md: completed(),
    article: completed(), summary: completed()
  })), true, 'isTaskCompleted: all critical + subs done → true');

  // isTaskCompleted: summary=skipped manually but vtt2md still pending → false
  assert.strictEqual(isTaskCompleted(makeTask('media', {
    fetch: completed(), subs: completed(), summary: { status: 'skipped', attempts: 0, error: null }
    // vtt2md still pending
  })), false, 'isTaskCompleted: summary skipped but vtt2md pending → false');

  // isTaskCompleted: asr path — subs=failed, asr=completed, rest done → true
  assert.strictEqual(isTaskCompleted(makeTask('media', {
    fetch: completed(), subs: failed(), asr: completed(),
    vtt2md: completed(), article: completed(), summary: completed()
  })), true, 'isTaskCompleted: ASR path completed → true');
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: `TypeError: isTaskFailed is not a function`

- [ ] **Step 3: Implement `isTaskFailed` and `isTaskCompleted` in `schedule.js`**

Add immediately after `isNodeReachable`:

```javascript
/**
 * Returns true when the task has provably failed (terminal node unreachable).
 * Replaces isContentStepFailure + CONTENT_STEPS in index.js.
 * @param {{ params: { mode: string }, steps: object }} task
 * @returns {boolean}
 */
function isTaskFailed(task) {
  const mode = normalizeMode((task.params && task.params.mode) || 'media');
  const steps = task.steps || {};
  return !isNodeReachable(TERMINAL_NODE, steps, mode, new Set());
}

/**
 * Returns true when the task has completed successfully.
 * All CRITICAL_PATH nodes must be completed/skipped AND at least one of
 * subs/asr must have actually completed (not just been skipped).
 * Stricter than checking summary.status alone — prevents false completion
 * when skipStep('summary') is called manually without the pipeline running.
 * @param {{ steps: object }} task
 * @returns {boolean}
 */
function isTaskCompleted(task) {
  const steps = task.steps || {};
  const criticalDone = CRITICAL_PATH.every(function(n) {
    const s = steps[n] && steps[n].status;
    return s === 'completed' || s === 'skipped';
  });
  if (!criticalDone) return false;
  const subsOrAsrDone =
    (steps.subs && (steps.subs.status === 'completed' || steps.subs.status === 'skipped')) ||
    (steps.asr && steps.asr.status === 'completed');
  return !!subsOrAsrDone;
}
```

- [ ] **Step 4: Add to `module.exports`**

In `module.exports`, add `isTaskFailed` and `isTaskCompleted`:

```javascript
module.exports = {
  STEP_EDGES,
  ALL_STEPS,
  PREDECESSORS,
  SUCCESSORS,
  GATE_TYPE,
  TERMINAL_NODE,
  CRITICAL_PATH,
  computeReadySteps,
  pickNextStep,
  getDownstreamClosure,
  excludedByMode,
  normalizeMode,
  isNodeReachable,
  isTaskFailed,
  isTaskCompleted
};
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: `orchestrator-schedule.test.js: PASS`

- [ ] **Step 6: Commit**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(schedule): add isTaskFailed and isTaskCompleted"
```

---

### Task 3: Generalize `computeReadySteps` OR logic

**Files:**
- Modify: `core/orchestrator/schedule.js` (update `computeReadySteps`)
- Modify: `tests/orchestrator-schedule.test.js` (verify existing tests still pass; no new tests needed — existing coverage is sufficient)

- [ ] **Step 1: Verify existing `computeReadySteps` tests pass (baseline)**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: `orchestrator-schedule.test.js: PASS`  
(All existing `computeReadySteps` tests must pass before changing anything.)

- [ ] **Step 2: Replace the hardcoded `vtt2md` block in `computeReadySteps`**

In `core/orchestrator/schedule.js`, find the `computeReadySteps` function. Locate this block (around line 168–185):

```javascript
    let ok;
    if (name === 'vtt2md') {
      // OR predecessor: subs completed OR asr completed.
      // Hardcoded intentionally — vtt2md has special OR semantics not expressible
      // by the generic AND loop; update both STEP_EDGES and this block if predecessors change.
      const subsOk = predecessorSatisfied(task, 'subs');
      const asrOk = predecessorSatisfied(task, 'asr');
      ok = subsOk || asrOk;
    } else {
      ok = true;
      const preds = PREDECESSORS[name] || [];
      for (const p of preds) {
        if (!predecessorSatisfied(task, p)) {
          ok = false;
          break;
        }
      }
    }
```

Replace it with:

```javascript
    const gate  = GATE_TYPE[name] || 'AND';
    const preds = PREDECESSORS[name] || [];
    let ok;
    if (gate === 'OR') {
      ok = preds.some(function(p) { return predecessorSatisfied(task, p); });
    } else {
      ok = preds.every(function(p) { return predecessorSatisfied(task, p)); });
    }
```

Note: `computeReadySteps` uses `predecessorSatisfied` (completed OR skipped), which is correct for scheduling. The stricter "output-producing" OR semantics live in `isNodeReachable` only.

- [ ] **Step 3: Run tests — expect PASS**

```bash
node tests/orchestrator-schedule.test.js
```

Expected: `orchestrator-schedule.test.js: PASS`  
All existing `computeReadySteps` tests exercise the same scenarios (subs=completed → vtt2md ready; asr=completed → vtt2md ready; both pending → vtt2md not ready). They will pass unchanged because `predecessorSatisfied` behaviour is identical.

- [ ] **Step 4: Run the full orchestrator unit test suite**

```bash
npm run test:orchestrator:unit
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add core/orchestrator/schedule.js
git commit -m "refactor(schedule): generalize computeReadySteps OR logic via GATE_TYPE"
```

---

### Task 4: Update `index.js` — wire `isTaskFailed`/`isTaskCompleted`, remove old helpers

**Files:**
- Modify: `core/orchestrator/index.js`

- [ ] **Step 1: Update the `require` import at the top of `index.js`**

Find line 10 (the `schedule` import):

```javascript
const { computeReadySteps, pickNextStep, getDownstreamClosure, excludedByMode, normalizeMode } = require('./schedule');
```

Replace with:

```javascript
const { computeReadySteps, pickNextStep, getDownstreamClosure, excludedByMode, normalizeMode, isTaskFailed, isTaskCompleted } = require('./schedule');
```

- [ ] **Step 2: Remove `CONTENT_STEPS` and `isContentStepFailure`**

Find and delete these two blocks (lines 12–32):

```javascript
// Steps whose failure marks the overall task as failed (media steps are non-blocking).
const CONTENT_STEPS = new Set(['fetch', 'subs', 'asr', 'vtt2md', 'md2vtt', 'article', 'summary']);

/**
 * Returns true if a content step failure should propagate as task failure.
 * subs and asr are OR-paired: subs failure is recoverable if asr completed,
 * and asr failure is recoverable if subs completed/skipped.
 */
function isContentStepFailure(stepName, steps) {
  if (!CONTENT_STEPS.has(stepName)) return false;
  const s = steps[stepName];
  if (!s || s.status !== 'failed') return false;
  if (stepName === 'subs') {
    return (steps.asr && steps.asr.status) !== 'completed';
  }
  if (stepName === 'asr') {
    const subs = steps.subs;
    return !(subs && (subs.status === 'completed' || subs.status === 'skipped'));
  }
  return true;
}
```

Delete both blocks entirely.

- [ ] **Step 3: Update `loadTaskFromDb` — replace status computation**

Find this block in `loadTaskFromDb` (around lines 215–229):

```javascript
  const statusList = Object.values(steps).map((s) => s.status);
  const contentFailed = Object.keys(steps).some(name => isContentStepFailure(name, steps));
  let status = 'pending';
  if (statusList.some((s) => s === 'running')) status = 'running';
  else if (contentFailed) status = 'failed';
  else if (statusList.every((s) => s === 'completed' || s === 'skipped' || s === 'failed' || s === 'pending')) {
    // completed if all content steps are done (media steps may still be pending/failed)
    const subsOrAsrDone =
      steps.subs?.status === 'completed' || steps.subs?.status === 'skipped' ||
      steps.asr?.status === 'completed';
    const contentDone =
      ['fetch', 'vtt2md', 'article', 'summary'].every(
        (n) => steps[n]?.status === 'completed' || steps[n]?.status === 'skipped'
      ) && subsOrAsrDone;
    if (contentDone) status = 'completed';
  }
```

Replace with:

```javascript
  const statusList = Object.values(steps).map((s) => s.status);
  const tempTask = { params: { mode: row.mode }, steps };
  let status = 'pending';
  if (statusList.some((s) => s === 'running')) status = 'running';
  else if (isTaskFailed(tempTask))    status = 'failed';
  else if (isTaskCompleted(tempTask)) status = 'completed';
```

- [ ] **Step 4: Update `runTask` — end of try block**

Find this block near the end of the `try` block in `runTask` (around lines 932–936):

```javascript
    // Mark overall task status.
    // subs failure alone does not fail the task — only subs+asr both failed does.
    const contentStepFailed = Object.keys(task.steps || {}).some(
      name => isContentStepFailure(name, task.steps || {})
    );
    task.status = contentStepFailed ? 'failed' : 'completed';
```

Replace with:

```javascript
    // Mark overall task status using DAG reachability.
    task.status = isTaskFailed(task) ? 'failed' : (isTaskCompleted(task) ? 'completed' : task.status);
```

- [ ] **Step 5: Update `runTask` — finally block reconciliation**

Find this block in the `finally` block (around lines 985–993):

```javascript
        task.steps = steps;

        // Re-evaluate overall task status after filesystem reconciliation.
        const reconContentFailed = Object.keys(steps).some(name => isContentStepFailure(name, steps));
        const reconStatus = reconContentFailed ? 'failed' : 'completed';
        if (task.status !== reconStatus) {
          task.status = reconStatus;
          task.updated_at = new Date().toISOString();
          emitOrchestratorEvent('task.updated', taskId, { status: task.status });
        }
```

Replace with:

```javascript
        task.steps = steps;

        // Re-evaluate overall task status after filesystem reconciliation.
        const reconStatus = isTaskFailed(task) ? 'failed' : (isTaskCompleted(task) ? 'completed' : task.status);
        if (task.status !== reconStatus) {
          task.status = reconStatus;
          task.updated_at = new Date().toISOString();
          emitOrchestratorEvent('task.updated', taskId, { status: task.status });
        }
```

- [ ] **Step 6: Run the full core test suite**

```bash
npm run test:agent:core
```

Expected: all tests pass. This runs:
- `tests/step-artifacts.test.js`
- `tests/orchestrator-progress-logging.test.js`
- `tests/orchestrator-schedule.test.js`
- `tests/apply-reset-scope.test.js`
- `tests/reset-scope-http.test.js`
- `tests/reset-scope-all-steps-http.test.js`
- `tests/service-client-reset-scope-all-steps.test.js`
- `tests/runstep-a-layer-orchestrator.test.js`
- `tests/agent-http.test.js`
- `tests/agent-sqlite-persistence.test.js`

- [ ] **Step 7: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "refactor(orchestrator): replace isContentStepFailure with DAG reachability"
```
