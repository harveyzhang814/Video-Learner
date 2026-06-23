'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../core/paths');

function withTmp(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-wdres-'));
  try { return fn(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function writeSettings(rootDir, body) {
  fs.mkdirSync(path.join(rootDir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'scripts', 'settings.conf'), body, 'utf8');
}

let failures = 0;
function check(name, fn) {
  const saved = process.env.WORK_ROOT;
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
  finally { if (saved === undefined) delete process.env.WORK_ROOT; else process.env.WORK_ROOT = saved; }
}

// 1. 默认：无 env、无 settings → rootDir
check('default falls back to rootDir', () => withTmp((tmp) => {
  delete process.env.WORK_ROOT;
  assert.strictEqual(paths.resolveWorkBase(tmp), path.resolve(tmp));
  assert.strictEqual(paths.getWorkRoot(tmp), path.join(tmp, 'work'));
  assert.strictEqual(paths.getDbPath(tmp), path.join(tmp, 'work', 'database.sqlite'));
  assert.strictEqual(paths.getIndexPath(tmp), path.join(tmp, 'work', 'index.jsonl'));
}));

// 2. settings.conf 提供 WORK_ROOT（绝对路径）
check('settings.conf WORK_ROOT wins over default', () => withTmp((tmp) => {
  delete process.env.WORK_ROOT;
  const target = path.join(tmp, 'external');
  writeSettings(tmp, `OUTPUT_LANG=zh-CN\nWORK_ROOT=${target}\n`);
  assert.strictEqual(paths.resolveWorkBase(tmp), path.resolve(target));
  assert.strictEqual(paths.getWorkRoot(tmp), path.join(target, 'work'));
}));

// 3. env 覆盖 settings.conf
check('env WORK_ROOT overrides settings.conf', () => withTmp((tmp) => {
  writeSettings(tmp, `WORK_ROOT=${path.join(tmp, 'fromfile')}\n`);
  const envTarget = path.join(tmp, 'fromenv');
  process.env.WORK_ROOT = envTarget;
  assert.strictEqual(paths.resolveWorkBase(tmp), path.resolve(envTarget));
}));

// 4. ~ 展开
check('expands leading ~', () => withTmp((tmp) => {
  process.env.WORK_ROOT = '~/vl-sync-test';
  assert.strictEqual(paths.resolveWorkBase(tmp), path.join(process.env.HOME, 'vl-sync-test'));
}));

// 5. $VAR 展开
check('expands $VAR', () => withTmp((tmp) => {
  process.env.WORK_ROOT = '$HOME/vl-var-test';
  assert.strictEqual(paths.resolveWorkBase(tmp), path.join(process.env.HOME, 'vl-var-test'));
}));

// 6. 去末尾斜杠
check('strips trailing slash', () => withTmp((tmp) => {
  const target = path.join(tmp, 'trail');
  process.env.WORK_ROOT = target + '/';
  assert.strictEqual(paths.resolveWorkBase(tmp), path.resolve(target));
}));

// 7. 空字符串视为未设置
check('empty string treated as unset', () => withTmp((tmp) => {
  process.env.WORK_ROOT = '';
  assert.strictEqual(paths.resolveWorkBase(tmp), path.resolve(tmp));
}));

// 8. settings.conf 带引号
check('quoted settings value is unquoted', () => withTmp((tmp) => {
  delete process.env.WORK_ROOT;
  const target = path.join(tmp, 'quoted');
  writeSettings(tmp, `WORK_ROOT="${target}"\n`);
  assert.strictEqual(paths.resolveWorkBase(tmp), path.resolve(target));
}));

if (failures > 0) { console.error(`work-dir-resolution.test.js: FAIL (${failures})`); process.exit(1); }
console.log('work-dir-resolution.test.js: PASS');
