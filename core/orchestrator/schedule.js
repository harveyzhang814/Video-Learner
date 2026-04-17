'use strict';

/**
 * DAG edges: predecessor → successor (B-layer schedule).
 * fetch fans out to video, audio, subs; subs → vtt2md; vtt2md → md2vtt & article; article → summary.
 */
const STEP_EDGES = [
  ['fetch', 'video'],
  ['fetch', 'audio'],
  ['fetch', 'subs'],
  ['fetch', 'asr'],
  ['subs', 'vtt2md'],
  ['asr', 'vtt2md'],
  ['vtt2md', 'md2vtt'],
  ['vtt2md', 'article'],
  ['article', 'summary']
];

const ALL_STEPS = [
  'fetch',
  'video',
  'audio',
  'subs',
  'asr',
  'vtt2md',
  'md2vtt',
  'article',
  'summary'
];

/** stepName -> predecessor step names */
const PREDECESSORS = (() => {
  const m = {};
  for (const [from, to] of STEP_EDGES) {
    if (!m[to]) m[to] = [];
    m[to].push(from);
  }
  return m;
})();

/** stepName -> successor step names (forward DAG for downstream closure). */
const SUCCESSORS = (() => {
  const m = {};
  for (const name of ALL_STEPS) {
    m[name] = [];
  }
  for (const [from, to] of STEP_EDGES) {
    m[from].push(to);
  }
  return m;
})();

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
 * All CRITICAL_PATH nodes must be completed/skipped AND:
 *   - subs must be completed or skipped, OR asr must be completed.
 * Note: asr must be completed (not just skipped) because a skipped asr
 * produced no transcript. subs=skipped is allowed (e.g., transcript fast-path).
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

/**
 * All nodes reachable from `stepName` following edges from → to (includes `stepName`).
 * @param {string} stepName
 * @returns {Set<string>}
 */
function getDownstreamClosure(stepName) {
  const out = new Set();
  if (!ALL_STEPS.includes(stepName)) {
    return out;
  }
  const queue = [stepName];
  while (queue.length > 0) {
    const n = queue.shift();
    if (out.has(n)) continue;
    out.add(n);
    for (const s of SUCCESSORS[n] || []) {
      if (!out.has(s)) queue.push(s);
    }
  }
  return out;
}

/** Main-chain order for pickNextStep (highest priority). */
const PRIMARY_CHAIN = ['fetch', 'subs', 'vtt2md', 'article', 'summary'];

/**
 * Secondary-chain order; filtered by mode inside pickNextStep.
 * both: video + md2vtt (never audio, matching runTask).
 * asr is also secondary-chain — only activates when subs failed and media is ready.
 */
const SECONDARY_CHAIN_BASE = ['video', 'audio', 'asr', 'md2vtt'];

function predecessorSatisfied(task, predName) {
  const st = task.steps && task.steps[predName];
  const status = st && st.status;
  return status === 'completed' || status === 'skipped';
}

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

  // asr: fallback step — only runs when subs failed AND media is available
  const subsFailed = steps && steps.subs && steps.subs.status === 'failed';
  if (!subsFailed || m === 'transcript') {
    ex.add('asr');
  } else if (m === 'audio') {
    const audioOk = steps && steps.audio && steps.audio.status === 'completed';
    if (!audioOk) ex.add('asr');
  } else {
    // media and full: need video.mp4 or audio.m4a (audio fallback in media mode)
    const videoOk = steps && steps.video && steps.video.status === 'completed';
    const audioOk = steps && steps.audio && steps.audio.status === 'completed';
    if (!videoOk && !audioOk) ex.add('asr');
  }

  return ex;
}

function secondaryChainForMode(mode, steps) {
  const m = normalizeMode(mode);
  return SECONDARY_CHAIN_BASE.filter((name) => !excludedByMode(m, steps).has(name));
}

/**
 * @param {object} task
 * @param {object} task.params
 * @param {string} [task.params.mode]
 * @param {object} task.steps
 * @returns {Set<string>}
 */
function computeReadySteps(task) {
  const mode = normalizeMode((task.params && task.params.mode) || 'media');
  const excluded = excludedByMode(mode, task.steps);
  const ready = new Set();

  for (const name of ALL_STEPS) {
    if (excluded.has(name)) continue;
    const step = task.steps && task.steps[name];
    if (!step || step.status !== 'pending') continue;

    const gate  = GATE_TYPE[name] || 'AND';
    const preds = PREDECESSORS[name] || [];
    let ok;
    if (gate === 'OR') {
      ok = preds.some(function(p) { return predecessorSatisfied(task, p); });
    } else {
      ok = preds.every(function(p) { return predecessorSatisfied(task, p); });
    }
    if (ok) ready.add(name);
  }

  return ready;
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

module.exports = {
  STEP_EDGES,
  ALL_STEPS,
  PREDECESSORS,
  SUCCESSORS,
  GATE_TYPE,
  TERMINAL_NODE,
  CRITICAL_PATH,
  isNodeReachable,
  isTaskFailed,
  isTaskCompleted,
  computeReadySteps,
  pickNextStep,
  getDownstreamClosure,
  excludedByMode,
  normalizeMode
};
