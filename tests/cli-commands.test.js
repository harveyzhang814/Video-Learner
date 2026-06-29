'use strict';
const assert = require('assert');
const { spawnSync } = require('child_process');
const { parseArgs } = require('../cli/commands/run');

const ROOT = require('path').resolve(__dirname, '..');
const CLI = require('path').join(ROOT, 'cli/index.js');

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 5000,
    ...opts,
  });
}

(async () => {
  // === parseArgs tests ===

  // Defaults
  let opts = parseArgs(['https://youtube.com/watch?v=abc']);
  assert.strictEqual(opts.url, 'https://youtube.com/watch?v=abc');
  assert.strictEqual(opts.focus, '');
  assert.strictEqual(opts.mode, 'media');
  assert.strictEqual(opts.lang, 'zh-CN');
  assert.strictEqual(opts.force, false);
  assert.strictEqual(opts.json, false);

  // All flags
  opts = parseArgs([
    'https://youtube.com/watch?v=abc',
    '--focus', 'tech details',
    '--mode', 'transcript',
    '--lang', 'en',
    '--force',
    '--json',
  ]);
  assert.strictEqual(opts.focus, 'tech details');
  assert.strictEqual(opts.mode, 'transcript');
  assert.strictEqual(opts.lang, 'en');
  assert.strictEqual(opts.force, true);
  assert.strictEqual(opts.json, true);

  // No URL → url is null
  opts = parseArgs(['--focus', 'test']);
  assert.strictEqual(opts.url, null);

  // === parseArgs: local file path detection ===

  // Absolute path → filePath set, url null
  opts = parseArgs(['/recordings/meeting.mp3']);
  assert.strictEqual(opts.filePath, '/recordings/meeting.mp3', 'absolute path → filePath');
  assert.strictEqual(opts.url, null, 'absolute path → url null');

  // Relative ./ path
  opts = parseArgs(['./audio.m4a']);
  assert.strictEqual(opts.filePath, './audio.m4a', 'relative ./ → filePath');
  assert.strictEqual(opts.url, null, 'relative ./ → url null');

  // Relative ../ path
  opts = parseArgs(['../audio.wav']);
  assert.strictEqual(opts.filePath, '../audio.wav', 'relative ../ → filePath');

  // URL still routes to url, not filePath
  opts = parseArgs(['https://youtube.com/watch?v=xyz']);
  assert.strictEqual(opts.url, 'https://youtube.com/watch?v=xyz', 'url still detected');
  assert.strictEqual(opts.filePath, null, 'url → filePath null');

  // --src-lang
  opts = parseArgs(['/recording.mp3', '--src-lang', 'zh']);
  assert.strictEqual(opts.srcLang, 'zh', '--src-lang zh');
  assert.strictEqual(opts.filePath, '/recording.mp3', 'filePath preserved with --src-lang');

  // srcLang defaults to 'en'
  opts = parseArgs(['/recording.mp3']);
  assert.strictEqual(opts.srcLang, 'en', 'srcLang defaults to en');

  // modeExplicit false by default
  opts = parseArgs(['/recording.mp3']);
  assert.strictEqual(opts.modeExplicit, false, 'modeExplicit defaults to false');

  // --mode sets modeExplicit = true
  opts = parseArgs(['/video.mp4', '--mode', 'audio']);
  assert.strictEqual(opts.modeExplicit, true, '--mode sets modeExplicit=true');
  assert.strictEqual(opts.mode, 'audio', '--mode audio preserved');

  // === CLI subprocess: local file routing ===

  // Absolute path that doesn't exist → exit 1 with "File not found", not "Unknown command"
  let r = runCli(['/definitely/not/here.mp3', '--focus', 'test']);
  assert.strictEqual(r.status, 1, 'nonexistent local file → exit 1');
  assert.ok(
    r.stderr.includes('File not found') || r.stderr.includes('not found'),
    `expected "File not found" in stderr, got: ${r.stderr}`
  );
  assert.ok(!r.stderr.includes('Unknown command'), 'absolute local path must not say Unknown command');

  // Relative ./ path that doesn't exist → same routing check
  r = runCli(['./not-here.mp3', '--focus', 'test']);
  assert.strictEqual(r.status, 1, 'relative nonexistent file → exit 1');
  assert.ok(!r.stderr.includes('Unknown command'), 'relative local path must not say Unknown command');

  // === CLI subprocess error path tests ===

  // vdl status (no task_id) → exit 1
  r = runCli(['status']);
  assert.strictEqual(r.status, 1, 'status with no task_id should exit 1');
  assert.ok(r.stderr.includes('Usage'), `expected Usage in stderr, got: ${r.stderr}`);

  // vdl result (no task_id) → exit 1
  r = runCli(['result']);
  assert.strictEqual(r.status, 1, 'result with no task_id should exit 1');

  // vdl result abc123 --type invalid → exit 1
  r = runCli(['result', 'abc123', '--type', 'invalid']);
  assert.strictEqual(r.status, 1, 'result with invalid type should exit 1');
  assert.ok(r.stderr.includes('summary') || r.stderr.includes('article'), `expected type hint in stderr, got: ${r.stderr}`);

  // vdl rerun (no args) → exit 1
  r = runCli(['rerun']);
  assert.strictEqual(r.status, 1, 'rerun with no args should exit 1');

  // vdl rerun abc123 fetch --reset badvalue → exit 1
  r = runCli(['rerun', 'abc123', 'fetch', '--reset', 'badvalue']);
  assert.strictEqual(r.status, 1, 'rerun with invalid --reset should exit 1');

  // === Module shape checks ===

  const rerunModule = require('../cli/commands/rerun');
  assert.ok(typeof rerunModule.run === 'function', 'rerun should export run');

  const listModule = require('../cli/commands/list');
  assert.ok(typeof listModule.run === 'function', 'list should export run');

  // === list with no DB — should exit 0 ===
  // Run in a temp dir env where work/database.sqlite won't exist
  const listResult = spawnSync(process.execPath, [CLI, 'list'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, HOME: require('os').tmpdir() },
  });
  // Either prints "No tasks found." (no DB) or shows tasks (if work/database.sqlite exists)
  // Either way it should exit 0
  assert.strictEqual(listResult.status, 0, `list should exit 0, got stderr: ${listResult.stderr}`);

  console.log('cli-commands: PASS');
})().catch(err => { console.error(err); process.exit(1); });
