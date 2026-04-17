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

**A task fails when its terminal node is provably unreachable. A task completes when its terminal node is completed/skipped.** All routing and failure logic derives from the DAG structure.

## DAG Structure Extensions (`schedule.js`)

Two new constants alongside the existing `STEP_EDGES` / `ALL_STEPS`:

```javascript
// Gate type per node. Omitted nodes default to AND.
// AND: all predecessors must complete before this node can run.
// OR:  at least one predecessor must complete.
const GATE_TYPE = {
  vtt2md: 'OR'
};

// The single terminal node. Task is complete when this node is completed/skipped.
const TERMINAL_NODE = 'summary';
```

`STEP_EDGES`, `ALL_STEPS`, `PREDECESSORS`, `SUCCESSORS` are unchanged.

## Reachability Algorithm

New pure function `isNodeReachable(node, steps, mode, visited)` in `schedule.js`.

**Definition:** A node is reachable if it can still reach `completed` or `skipped`.

| Step status | Reachable? |
|-------------|------------|
| `completed` / `skipped` | Yes |
| `running` / `pending` | Depends on predecessors |
| `failed` | No (terminal) |
| Excluded by mode | Yes (treated as effectively skipped) |

**Predecessor logic:**
- **AND gate** (default): all predecessors reachable
- **OR gate** (`GATE_TYPE[node] === 'OR'`): at least one predecessor reachable

```
isNodeReachable(node, steps, mode, visited = new Set()):
  if visited.has(node): return false        // cycle guard (DAG is acyclic; defensive)
  if excludedByMode(mode, steps).has(node): return true

  status = steps[node]?.status ?? 'pending'
  if status === 'completed' or 'skipped':   return true
  if status === 'failed':                   return false

  // pending / running: check predecessors
  visited.add(node)
  preds = PREDECESSORS[node] ?? []
  if preds.length === 0: return true        // root node (fetch)

  if GATE_TYPE[node] === 'OR':
    return preds.some(p => isNodeReachable(p, steps, mode, visited))
  else:
    return preds.every(p => isNodeReachable(p, steps, mode, visited))
```

## Public Interface

Two new exported functions from `schedule.js`:

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
 * Returns true when the task has completed (terminal node completed/skipped).
 */
function isTaskCompleted(task) {
  const steps = task.steps || {};
  const s = steps[TERMINAL_NODE]?.status;
  return s === 'completed' || s === 'skipped';
}
```

## Changes to `computeReadySteps`

Remove the hardcoded `vtt2md` special case; replace with gate-type-driven logic:

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
task.status = isTaskFailed(task) ? 'failed' : 'completed';
```

Similarly replace the `reconContentFailed` check in the `finally` block.

## Silent Bug Fix

`CONTENT_STEPS` currently includes `md2vtt`. Because `md2vtt` is a side branch (`vtt2md → md2vtt`, not on the path to `summary`), `md2vtt=failed` would incorrectly mark the task as failed under the old logic. The reachability algorithm naturally ignores `md2vtt` failures when computing whether `summary` is reachable — no special handling needed.

## File Changes

| File | Change |
|------|--------|
| `core/orchestrator/schedule.js` | Add `GATE_TYPE`, `TERMINAL_NODE`; add `isNodeReachable`, `isTaskFailed`, `isTaskCompleted`; export all three; generalize `computeReadySteps` OR logic |
| `core/orchestrator/index.js` | Remove `isContentStepFailure`, `CONTENT_STEPS`; import `isTaskFailed`, `isTaskCompleted`; update `loadTaskFromDb` and `runTask` (try + finally) |
| `tests/orchestrator-schedule.test.js` | Add test cases for `isTaskFailed` and `isTaskCompleted` |

HTTP routes, GUI, and shell scripts are unaffected.

## Not In Scope

- Changes to `excludedByMode` logic
- Adding new steps or edges to the DAG
- GUI display of step-level failure reasons
