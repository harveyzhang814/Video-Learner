'use strict';
const assert = require('assert');
const { displayName, statusIcon, buildProgressLines } = require('../cli/lib/format');

assert.strictEqual(displayName('fetch'), 'fetch_info');
assert.strictEqual(displayName('subs'), 'download_subs');
assert.strictEqual(displayName('vtt2md'), 'convert_vtt_md');
assert.strictEqual(displayName('article'), 'generate_article');
assert.strictEqual(displayName('summary'), 'generate_summary');
assert.strictEqual(displayName('video'), 'download_video');
assert.strictEqual(displayName('audio'), 'download_audio');
assert.strictEqual(displayName('asr'), 'asr_transcribe');
assert.strictEqual(displayName('md2vtt'), 'convert_md_vtt');
assert.strictEqual(displayName('unknown_step'), 'unknown_step');

assert.strictEqual(statusIcon('done'), '✓');
assert.strictEqual(statusIcon('running'), '⠸');
assert.strictEqual(statusIcon('failed'), '✗');
assert.strictEqual(statusIcon('skipped'), '–');
assert.strictEqual(statusIcon('pending'), ' ');

const lines = buildProgressLines('Test Video', {
  fetch: { status: 'done' },
  subs: { status: 'running' },
});
assert.ok(lines.some(l => l.includes('fetch_info')), 'should include fetch_info');
assert.ok(lines.some(l => l.includes('download_subs')), 'should include download_subs');
assert.ok(lines.some(l => l.includes('✓')), 'should include done icon');
assert.ok(lines.some(l => l.includes('⠸')), 'should include running icon');

console.log('cli-format: PASS');

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
