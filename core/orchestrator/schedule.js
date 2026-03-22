'use strict';

/**
 * DAG edges: predecessor → successor (B-layer schedule).
 * fetch fans out to video, audio, subs; subs → vtt2md; vtt2md → md2vtt & article; article → summary.
 */
const STEP_EDGES = [
  ['fetch', 'video'],
  ['fetch', 'audio'],
  ['fetch', 'subs'],
  ['subs', 'vtt2md'],
  ['vtt2md', 'md2vtt'],
  ['vtt2md', 'article'],
  ['article', 'summary']
];

const ALL_STEPS = [
  'fetch',
  'video',
  'audio',
  'subs',
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

/** Main-chain order for pickNextStep (highest priority). */
const PRIMARY_CHAIN = ['fetch', 'subs', 'vtt2md', 'article', 'summary'];

/**
 * Secondary-chain order; filtered by mode inside pickNextStep.
 * both: video + md2vtt (never audio, matching runTask).
 */
const SECONDARY_CHAIN_BASE = ['video', 'audio', 'md2vtt'];

function predecessorSatisfied(task, predName) {
  const st = task.steps && task.steps[predName];
  const status = st && st.status;
  return status === 'completed' || status === 'skipped';
}

/**
 * Steps that must never be scheduled as candidates for this mode (even if pending).
 */
function excludedByMode(mode) {
  const m = mode || 'both';
  const ex = new Set();
  if (m === 'both' || m === 'video') {
    ex.add('audio');
  }
  if (m === 'audio') {
    ex.add('video');
  }
  if (m === 'transcript') {
    ex.add('video');
    ex.add('audio');
  }
  return ex;
}

function secondaryChainForMode(mode) {
  const m = mode || 'both';
  return SECONDARY_CHAIN_BASE.filter((name) => !excludedByMode(m).has(name));
}

/**
 * @param {object} task
 * @param {object} task.params
 * @param {string} [task.params.mode]
 * @param {object} task.steps
 * @returns {Set<string>}
 */
function computeReadySteps(task) {
  const mode = (task.params && task.params.mode) || 'both';
  const excluded = excludedByMode(mode);
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

/**
 * @param {Set<string>|string[]} readySet
 * @param {string} [mode]
 * @returns {string|null}
 */
function pickNextStep(readySet, mode) {
  const ready =
    readySet instanceof Set ? readySet : new Set(Array.isArray(readySet) ? readySet : []);
  const m = mode || 'both';

  for (const name of PRIMARY_CHAIN) {
    if (ready.has(name)) return name;
  }
  const secondary = secondaryChainForMode(m);
  for (const name of secondary) {
    if (ready.has(name)) return name;
  }
  return null;
}

module.exports = {
  STEP_EDGES,
  ALL_STEPS,
  PREDECESSORS,
  computeReadySteps,
  pickNextStep
};
