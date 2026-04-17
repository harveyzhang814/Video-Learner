# DAG Reachability-Based Task Failure Detection

**Date:** 2026-04-18
**Scope:** Replace hardcoded failure/completion checks with a general DAG reachability algorithm driven by the declared graph structure.

## Context

Two places in the codebase hand-code OR semantics that belong in the DAG:

1. **`isContentStepFailure`** (`index.js`) — hardcodes the `subs`/`asr` OR relationship to determine task failure.
2. **`computeReadySteps`** (`schedule.js`) — hardcodes `vtt2md`'s OR predecessor check.

Additionally, `CONTENT_STEPS` incorrectly includes `md2vtt`, causing `md2vtt=failed` to mark the whole task failed even though `md2vtt` is not on the path to `summary`.

This design replaces all three with a single data-driven reachability algorithm.

## Design Principle

**A task fails when its terminal node is provably unreachable. A task completes when every critical-path node is completed or skipped.** All routing and failure logic derives from the DAG structure.

## DAG Structure Extensions (`schedule.js`)

Two new constants alongside the existing `STEP_EDGES` / `ALL_STEPS`:

```javascript
// Gate type per node. Omitted nodes default to AND.
// AND: all predecessors must be completed/skipped before this node can run.
// OR:  at least one predecessor that can produce output must be completed/reachable.
const GATE_TYPE = {
  vtt2md: 'OR'
};

// The single terminal node. Task is complete when this node (and all critical-path
// predecessors) are completed/skipped.
const TERMINAL_NODE = 'summary';

// Critical path: nodes that must all be completed/skipped for isTaskCompleted.
// Excludes side-branch steps (md2vtt) that are not required for summary output.
const CRITICAL_PATH = ['fetch', 'vtt2md', 'article', 'summary'];
```

`STEP_EDGES`, `ALL_STEPS`, `PREDECESSORS`, `SUCCESSORS` are unchanged.

## Reachability Algorithm

New pure function `isNodeReachable(node, steps, mode, visited)` in `schedule.js`.

**Definition:** A node is reachable if it can still reach `completed` or `skipped` via a path that will actually produce the required output.

| Step status | Reachable? |
|-------------|------------|
| `completed` / `skipped` | Yes |
| `running` / `pending` (not excluded) | Depends on predecessors |
| `failed` | No (terminal) |
| Excluded by mode + `pending` | **No** — will never produce output |
| Excluded by mode + `completed`/`skipped` | Yes — already settled |

**Key distinction for OR gates:** A mode-excluded node that is still `pending` does NOT satisfy an OR gate — it will never run and will never produce output (e.g., VTT files). Only `completed` predecessors or `pending+runnable` predecessors count. This preserves the existing behaviour: in transcript mode, `subs=failed + asr=excluded+pending` → task failed immediately.

**Predecessor logic:**
- **AND gate** (default): all predecessors reachable
- **OR gate** (`GATE_TYPE[node] === 'OR'`): at least one predecessor reachable AND capable of producing output

```
isNodeReachable(node, steps, mode, visited = new Set()):
  if visited.has(node): return false        // cycle guard (DAG is acyclic; defensive)

  status = steps[node]?.status ?? 'pending'
  if status === 'completed' || status === 'skipped': return true
  if status === 'failed':                            return false

  // pending/running: check mode exclusion
  if excludedByMode(mode, steps).has(node): return false  // won't produce output

  // pending/running + not excluded: check predecessors
  visited.add(node)
  preds = PREDECESSORS[node] ?? []
  if preds.length === 0: return true        // root node (fetch)

  if GATE_TYPE[node] === 'OR':
    // OR gate: need at least one predecessor that can actually produce output.
    // Skipped and mode-excluded predecessors do NOT satisfy the OR gate.
    return preds.some(p => {
      const ps = steps[p]?.status ?? 'pending';
      if (ps === 'completed') return true;                    // produced output
      if (ps === 'skipped') return false;                     // no output produced
      if (excludedByMode(mode, steps).has(p)) return false;  // will never produce output
      return isNodeReachable(p, steps, mode, new Set(visited)); // path-local visited
    });
  else:
    // AND gate: all predecessors must be reachable (path-local visited per branch).
    return preds.every(p => isNodeReachable(p, steps, mode, new Set(visited)));
```

**Note on `visited` scoping:** Each recursive branch receives a copy (`new Set(visited)`) so that one branch's traversal does not mark shared ancestors as visited for sibling branches. This is safe for the current 9-node DAG and remains correct if the DAG gains converging paths.

## Public Interface

Three new exported functions from `schedule.js`:

```javascript
/**
 * Returns true when the task has provably failed (terminal node unreachable).
 * Replaces isContentStepFailure in index.js.
 */
function isTaskFailed(task) {
  const mode = normalizeMode(task.params?.mode);
  const steps = task.steps || {};
  return !isNodeReachable(TERMINAL_NODE, steps, mode, new Set());
}

/**
 * Returns true when the task has completed successfully.
 * All CRITICAL_PATH nodes must be completed or skipped, AND
 * at least one of subs/asr must have completed (not just skipped).
 * This preserves the stricter check from the existing loadTaskFromDb logic.
 */
function isTaskCompleted(task) {
  const steps = task.steps || {};
  const criticalDone = CRITICAL_PATH.every(
    n => steps[n]?.status === 'completed' || steps[n]?.status === 'skipped'
  );
  if (!criticalDone) return false;
  // vtt2md's OR predecessors: at least one must have actually completed (not just skipped)
  const subsOrAsrDone =
    steps.subs?.status === 'completed' || steps.subs?.status === 'skipped' ||
    steps.asr?.status === 'completed';
  return subsOrAsrDone;
}
```

**Why `isTaskCompleted` is stricter than just checking `summary.status`:** `skipStep('summary')` can be called manually as a test/escape-hatch, marking `summary=skipped` without any transcript or article being produced. The stricter check ensures task completion is only signalled when the pipeline actually ran.

## Changes to `computeReadySteps`

Remove the hardcoded `vtt2md` special case; replace with gate-type-driven logic.
`computeReadySteps` uses `predecessorSatisfied` (completed OR skipped), which is correct for scheduling — a skipped step releases the dependency. The OR gate in `isNodeReachable` uses stricter "output-producing" semantics only for failure detection.

```javascript
// Before:
if (name === 'vtt2md') {
  const subsOk = predecessorSatisfied(task, 'subs');
  const asrOk  = predecessorSatisfied(task, 'asr');
  ok = subsOk || asrOk;
} else {
  ok = true;
  for (const p of PREDECESSORS[name] || []) {
    if (!predecessorSatisfied(task, p)) { ok = false; break; }
  }
}

// After:
const gate  = GATE_TYPE[name] || 'AND';
const preds = PREDECESSORS[name] || [];
if (gate === 'OR') {
  ok = preds.some(p => predecessorSatisfied(task, p));
} else {
  ok = preds.every(p => predecessorSatisfied(task, p));
}
```

## Changes to `index.js`

### Remove
- `isContentStepFailure` function
- `CONTENT_STEPS` constant

### Replace in `loadTaskFromDb`

```javascript
// Before:
const contentFailed = Object.keys(steps).some(name => isContentStepFailure(name, steps));
let status = 'pending';
if (statusList.some(s => s === 'running')) status = 'running';
else if (contentFailed) status = 'failed';
else if (/* contentDone hardcoded check */) status = 'completed';

// After:
const tempTask = { params: { mode: row.mode }, steps };
let status = 'pending';
if (statusList.some(s => s === 'running')) status = 'running';
else if (isTaskFailed(tempTask))    status = 'failed';
else if (isTaskCompleted(tempTask)) status = 'completed';
```

### Replace in `runTask` (end of try block and finally reconciliation)

```javascript
// Before:
const contentStepFailed = Object.keys(task.steps || {})
  .some(name => isContentStepFailure(name, task.steps || {}));
task.status = contentStepFailed ? 'failed' : 'completed';

// After:
task.status = isTaskFailed(task) ? 'failed' : (isTaskCompleted(task) ? 'completed' : task.status);
```

Note: `isTaskCompleted` is used here instead of the simple `!isTaskFailed` binary. This avoids incorrectly stamping `completed` when the task loop exits with some steps still pending (which should not happen in normal serial execution but is defensive).

Similarly replace the `reconContentFailed` check in the `finally` block.

## Silent Bug Fix

`CONTENT_STEPS` currently includes `md2vtt`. Because `md2vtt` is a side branch (`vtt2md → md2vtt`, not on the path to `summary`), `md2vtt=failed` would incorrectly mark the task as failed under the old logic. The reachability algorithm naturally ignores `md2vtt` failures when computing whether `summary` is reachable — no special handling needed.

## Required Test Cases

`tests/orchestrator-schedule.test.js` must cover:

| Scenario | Expected result |
|----------|----------------|
| subs=completed, asr=pending → isTaskFailed | false |
| subs=failed, asr=completed → isTaskFailed | false |
| subs=failed, asr=failed → isTaskFailed | true |
| subs=failed, asr=excluded+pending (transcript mode) → isTaskFailed | **true** |
| md2vtt=failed, all others completed → isTaskFailed | false (silent bug fix) |
| vtt2md=pending, subs=failed, asr=pending (media mode, fetch=completed) → isTaskFailed | false (asr still runnable) |
| summary=skipped manually, vtt2md=pending → isTaskCompleted | false (stricter check) |
| loadTaskFromDb restore: subs=failed, asr=skipped → status | 'failed' |

## File Changes

| File | Change |
|------|--------|
| `core/orchestrator/schedule.js` | Add `GATE_TYPE`, `TERMINAL_NODE`, `CRITICAL_PATH`; add `isNodeReachable`, `isTaskFailed`, `isTaskCompleted`; export all three; generalize `computeReadySteps` OR logic |
| `core/orchestrator/index.js` | Remove `isContentStepFailure`, `CONTENT_STEPS`; import `isTaskFailed`, `isTaskCompleted`; update `loadTaskFromDb` and `runTask` (try + finally) |
| `tests/orchestrator-schedule.test.js` | Add test cases per the Required Test Cases table above |

HTTP routes, GUI, and shell scripts are unaffected.

## Not In Scope

- Changes to `excludedByMode` logic
- Adding new steps or edges to the DAG
- GUI display of step-level failure reasons
