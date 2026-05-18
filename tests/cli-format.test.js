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
