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

// Use a fresh tmpfile for all config writes to avoid touching ~/.config/vdl/settings.conf
const TMP_CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-cli-cfg-'));
const TMP_CFG = path.join(TMP_CFG_DIR, 'settings.conf');
// VDL_CONFIG_FILE must be set in every runCli call that touches config
const CFG_ENV = { VDL_CONFIG_FILE: TMP_CFG };

function restoreSettings() {
  try { fs.unlinkSync(TMP_CFG); } catch (_) {}
}

// vdl config get — no WORK_ROOT set
check('config get shows (default) when no WORK_ROOT', () => {
  const { code, out } = runCli(['config', 'get'], { ...CFG_ENV, WORK_ROOT: '' });
  assert.strictEqual(code, 0, `exit code: ${out}`);
  assert.ok(out.includes('(default'), `expected "(default" in: ${out}`);
  assert.ok(out.includes('workDir'), `expected workDir in: ${out}`);
});

// vdl config set work-root + verify user config file written (answer 'n' to migration prompt)
check('config set work-root writes to user config file', () => {
  try {
    const { code, out } = runCli(
      ['config', 'set', 'work-root', '/tmp/vl-cli-config-test'],
      { ...CFG_ENV, WORK_ROOT: '' },
      'n\n'   // decline migration prompt if shown
    );
    assert.strictEqual(code, 0, `exit code: ${out}`);
    assert.ok(out.includes('work-root set to') || out.includes('已设置为'), `expected confirmation in: ${out}`);
    assert.ok(out.toLowerCase().includes('restart') || out.includes('重启'), `expected restart notice in: ${out}`);
    const content = fs.readFileSync(TMP_CFG, 'utf8');
    assert.ok(content.includes('WORK_ROOT=/tmp/vl-cli-config-test'), `settings not written: ${content}`);
  } finally {
    restoreSettings();
  }
});

// vdl config get — reflects written value
check('config get reflects settings.conf value', () => {
  try {
    fs.mkdirSync(path.dirname(TMP_CFG), { recursive: true });
    fs.writeFileSync(TMP_CFG, 'WORK_ROOT=/tmp/vl-reflected\n', 'utf8');
    const { code, out } = runCli(['config', 'get'], { ...CFG_ENV, WORK_ROOT: '' });
    assert.strictEqual(code, 0, `exit code: ${out}`);
    assert.ok(out.includes('/tmp/vl-reflected'), `expected path in output: ${out}`);
  } finally {
    restoreSettings();
  }
});

// vdl config set — relative path rejected
check('config set rejects relative path', () => {
  const { code } = runCli(['config', 'set', 'work-root', 'relative/path'], { ...CFG_ENV, WORK_ROOT: '' });
  assert.notStrictEqual(code, 0, 'expected non-zero exit for relative path');
});

// vdl config set — empty value rejected
check('config set rejects empty path', () => {
  const { code } = runCli(['config', 'set', 'work-root'], { ...CFG_ENV, WORK_ROOT: '' });
  assert.notStrictEqual(code, 0, 'expected non-zero exit for missing value');
});

// vdl config set — unknown key rejected
check('config set rejects unknown key', () => {
  const { code } = runCli(['config', 'set', 'unknown-key', '/tmp/x'], { ...CFG_ENV, WORK_ROOT: '' });
  assert.notStrictEqual(code, 0, 'expected non-zero exit for unknown key');
});

if (failures > 0) { console.error(`cli-config.test.js: FAIL (${failures})`); process.exit(1); }
console.log('cli-config.test.js: PASS');
