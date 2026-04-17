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
  computeReadySteps,
  pickNextStep,
  getDownstreamClosure,
  excludedByMode,
  normalizeMode
};
