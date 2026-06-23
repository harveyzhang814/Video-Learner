'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.resolve(__dirname, '../cli/index.js');
const ROOT = path.resolve(__dirname, '..');

function runCli(args, env = {}, stdin = '') {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      input: stdin,
      env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const SETTINGS = path.join(ROOT, 'scripts', 'settings.conf');

// Read original settings.conf so we can restore it
let originalSettings = null;
try { originalSettings = fs.readFileSync(SETTINGS, 'utf8'); } catch (_) {}

function restoreSettings() {
  if (originalSettings === null) {
    try { fs.unlinkSync(SETTINGS); } catch (_) {}
  } else {
    fs.writeFileSync(SETTINGS, originalSettings, 'utf8');
  }
}

// vdl config get — no WORK_ROOT set
check('config get shows (default) when no WORK_ROOT', () => {
  const { code, out } = runCli(['config', 'get'], { WORK_ROOT: '' });
  assert.strictEqual(code, 0, `exit code: ${out}`);
  assert.ok(out.includes('(default)'), `expected "(default)" in: ${out}`);
  assert.ok(out.includes('workDir'), `expected workDir in: ${out}`);
});

// vdl config set work-root + verify settings.conf written (answer 'n' to migration prompt)
check('config set work-root writes to settings.conf', () => {
  try {
    const { code, out } = runCli(
      ['config', 'set', 'work-root', '/tmp/vl-cli-config-test'],
      { WORK_ROOT: '' },
      'n\n'   // decline migration prompt if shown
    );
    assert.strictEqual(code, 0, `exit code: ${out}`);
    assert.ok(out.includes('work-root set to') || out.includes('已设置为'), `expected confirmation in: ${out}`);
    assert.ok(out.toLowerCase().includes('restart') || out.includes('重启'), `expected restart notice in: ${out}`);
    const conf = fs.readFileSync(SETTINGS, 'utf8');
    assert.ok(conf.includes('WORK_ROOT=/tmp/vl-cli-config-test'), `settings.conf missing value: ${conf}`);
  } finally {
    restoreSettings();
  }
});

// vdl config get — reflects written value
check('config get reflects settings.conf value', () => {
  try {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
    fs.writeFileSync(SETTINGS, 'WORK_ROOT=/tmp/vl-reflected\n', 'utf8');
    const { code, out } = runCli(['config', 'get'], { WORK_ROOT: '' });
    assert.strictEqual(code, 0, `exit code: ${out}`);
    assert.ok(out.includes('/tmp/vl-reflected'), `expected path in output: ${out}`);
  } finally {
    restoreSettings();
  }
});

// vdl config set — relative path rejected
check('config set rejects relative path', () => {
  const { code } = runCli(['config', 'set', 'work-root', 'relative/path'], { WORK_ROOT: '' });
  assert.notStrictEqual(code, 0, 'expected non-zero exit for relative path');
});

// vdl config set — empty value rejected
check('config set rejects empty path', () => {
  const { code } = runCli(['config', 'set', 'work-root'], { WORK_ROOT: '' });
  assert.notStrictEqual(code, 0, 'expected non-zero exit for missing value');
});

// vdl config set — unknown key rejected
check('config set rejects unknown key', () => {
  const { code } = runCli(['config', 'set', 'unknown-key', '/tmp/x'], { WORK_ROOT: '' });
  assert.notStrictEqual(code, 0, 'expected non-zero exit for unknown key');
});

if (failures > 0) { console.error(`cli-config.test.js: FAIL (${failures})`); process.exit(1); }
console.log('cli-config.test.js: PASS');
