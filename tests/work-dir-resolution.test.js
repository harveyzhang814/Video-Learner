// tests/work-dir-resolution.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../core/paths');
const { DEFAULT_WORK_ROOT } = require('../core/user-config');

// Helper: create a temp config file, set VDL_CONFIG_FILE, run fn, restore.
function withTmpConfig(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-wdres-'));
  const cfgPath = path.join(dir, 'settings.conf');
  if (content !== null) fs.writeFileSync(cfgPath, content, 'utf8');
  const savedCfg = process.env.VDL_CONFIG_FILE;
  process.env.VDL_CONFIG_FILE = cfgPath;
  try { return fn(cfgPath); }
  finally {
    if (savedCfg === undefined) delete process.env.VDL_CONFIG_FILE;
    else process.env.VDL_CONFIG_FILE = savedCfg;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let failures = 0;
function check(name, fn) {
  const savedWR = process.env.WORK_ROOT;
  const savedCfg = process.env.VDL_CONFIG_FILE;
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
  finally {
    if (savedWR === undefined) delete process.env.WORK_ROOT; else process.env.WORK_ROOT = savedWR;
    if (savedCfg === undefined) delete process.env.VDL_CONFIG_FILE; else process.env.VDL_CONFIG_FILE = savedCfg;
  }
}

const DUMMY_ROOT = '/tmp/dummy-root';

// 1. Default: no env WORK_ROOT, config file missing → DEFAULT_WORK_ROOT
check('default falls back to DEFAULT_WORK_ROOT', () => {
  delete process.env.WORK_ROOT;
  // point VDL_CONFIG_FILE at a non-existent path so real ~/.config/vdl/settings.conf is ignored
  process.env.VDL_CONFIG_FILE = '/tmp/vl-nonexistent-' + Date.now() + '.conf';
  assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), DEFAULT_WORK_ROOT);
  assert.strictEqual(paths.getWorkRoot(DUMMY_ROOT), path.join(DEFAULT_WORK_ROOT, 'work'));
  assert.strictEqual(paths.getDbPath(DUMMY_ROOT), path.join(DEFAULT_WORK_ROOT, 'work', 'database.sqlite'));
  assert.strictEqual(paths.getIndexPath(DUMMY_ROOT), path.join(DEFAULT_WORK_ROOT, 'work', 'index.jsonl'));
});

// 2. VDL_CONFIG_FILE provides WORK_ROOT
check('VDL_CONFIG_FILE WORK_ROOT wins over default', () => {
  delete process.env.WORK_ROOT;
  withTmpConfig('OUTPUT_LANG=zh-CN\nWORK_ROOT=/tmp/vl-from-cfg\n', (cfgPath) => {
    assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), '/tmp/vl-from-cfg');
    assert.strictEqual(paths.getWorkRoot(DUMMY_ROOT), '/tmp/vl-from-cfg/work');
  });
});

// 3. env WORK_ROOT overrides VDL_CONFIG_FILE
check('env WORK_ROOT overrides VDL_CONFIG_FILE', () => {
  withTmpConfig('WORK_ROOT=/tmp/vl-from-file\n', () => {
    process.env.WORK_ROOT = '/tmp/vl-from-env';
    assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), '/tmp/vl-from-env');
  });
});

// 4. ~ expansion
check('expands leading ~', () => {
  process.env.WORK_ROOT = '~/vl-tilde-test';
  assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), path.join(os.homedir(), 'vl-tilde-test'));
});

// 5. $VAR expansion
check('expands $VAR', () => {
  process.env.WORK_ROOT = '$HOME/vl-var-test';
  assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), path.join(os.homedir(), 'vl-var-test'));
});

// 6. Trailing slash stripped
check('strips trailing slash', () => {
  process.env.WORK_ROOT = '/tmp/vl-trail/';
  assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), '/tmp/vl-trail');
});

// 7. Empty env string treated as unset
check('empty WORK_ROOT treated as unset → DEFAULT_WORK_ROOT', () => {
  process.env.WORK_ROOT = '';
  process.env.VDL_CONFIG_FILE = '/tmp/vl-nonexistent-empty.conf';
  assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), DEFAULT_WORK_ROOT);
});

// 8. Quoted value in config file
check('quoted config value is unquoted', () => {
  delete process.env.WORK_ROOT;
  withTmpConfig('WORK_ROOT="/tmp/vl-quoted"\n', () => {
    assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), '/tmp/vl-quoted');
  });
});

// --- writeWorkRoot (path-agnostic, behavior unchanged) ---

// 9. Creates file and writes value
check('writeWorkRoot creates file and writes value', () => {
  delete process.env.WORK_ROOT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-wwr-'));
  try {
    const p = path.join(dir, 'settings.conf');
    paths.writeWorkRoot(p, '/new/root');
    assert.ok(fs.readFileSync(p, 'utf8').includes('WORK_ROOT=/new/root'));
    // Verify it is readable back via VDL_CONFIG_FILE
    process.env.VDL_CONFIG_FILE = p;
    assert.strictEqual(paths.resolveWorkBase(DUMMY_ROOT), '/new/root');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 10. Updates existing value
check('writeWorkRoot updates existing WORK_ROOT line', () => {
  delete process.env.WORK_ROOT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-wwr2-'));
  try {
    const p = path.join(dir, 'settings.conf');
    fs.writeFileSync(p, 'OUTPUT_LANG=zh-CN\nWORK_ROOT=/old/root\n', 'utf8');
    paths.writeWorkRoot(p, '/new/root');
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(!content.includes('/old/root'), 'old value should be removed');
    assert.ok(content.includes('WORK_ROOT=/new/root'), 'new value should be present');
    assert.ok(content.includes('OUTPUT_LANG=zh-CN'), 'other keys preserved');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 11. Preserves commented WORK_ROOT lines
check('writeWorkRoot preserves commented WORK_ROOT lines', () => {
  delete process.env.WORK_ROOT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-wwr3-'));
  try {
    const p = path.join(dir, 'settings.conf');
    fs.writeFileSync(p, '# WORK_ROOT=~/example\nWORK_ROOT=/old\n', 'utf8');
    paths.writeWorkRoot(p, '/new/root');
    const content = fs.readFileSync(p, 'utf8');
    assert.ok(content.includes('# WORK_ROOT=~/example'), 'comment line preserved');
    assert.ok(content.includes('WORK_ROOT=/new/root'), 'new value present');
    assert.ok(!content.includes('WORK_ROOT=/old'), 'old uncommented value gone');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

if (failures > 0) { console.error(`work-dir-resolution.test.js: FAIL (${failures})`); process.exit(1); }
console.log('work-dir-resolution.test.js: PASS');
