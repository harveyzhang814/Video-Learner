'use strict';

/**
 * Parity: scripts/work_dir.sh and core/paths.js must resolve identical
 * WORK_DIR / DB_PATH for the same inputs. Guards against drift between the
 * two independent resolvers.
 */
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const paths = require('../core/paths');

const PROJECT = path.resolve(__dirname, '..');

function shellResolve(envWorkRoot) {
  const env = { ...process.env };
  if (envWorkRoot === null) delete env.WORK_ROOT;
  else env.WORK_ROOT = envWorkRoot;
  const out = execFileSync(
    'bash',
    ['-c', 'source "$0"; printf "%s\\n%s\\n" "$WORK_DIR" "$DB_PATH"', path.join(PROJECT, 'scripts', 'work_dir.sh')],
    { env, encoding: 'utf8' }
  );
  const [workDir, dbPath] = out.trim().split('\n');
  return { workDir, dbPath };
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// 1. 默认（无 env WORK_ROOT；项目根 scripts/settings.conf 可能存在也可能没有 WORK_ROOT）
check('default parity', () => {
  const saved = process.env.WORK_ROOT;
  delete process.env.WORK_ROOT;
  try {
    const shell = shellResolve(null);
    assert.strictEqual(shell.workDir, paths.getWorkRoot(PROJECT), 'WORK_DIR mismatch');
    assert.strictEqual(shell.dbPath, paths.getDbPath(PROJECT), 'DB_PATH mismatch');
  } finally {
    if (saved === undefined) delete process.env.WORK_ROOT; else process.env.WORK_ROOT = saved;
  }
});

// 2. env 绝对路径
check('env absolute parity', () => {
  const target = path.join(process.env.HOME, 'vl-parity-abs');
  const saved = process.env.WORK_ROOT;
  process.env.WORK_ROOT = target;
  try {
    const shell = shellResolve(target);
    assert.strictEqual(shell.workDir, paths.getWorkRoot(PROJECT));
    assert.strictEqual(shell.dbPath, paths.getDbPath(PROJECT));
  } finally {
    if (saved === undefined) delete process.env.WORK_ROOT; else process.env.WORK_ROOT = saved;
  }
});

// 3. env 带 ~ 展开
check('env tilde parity', () => {
  const saved = process.env.WORK_ROOT;
  process.env.WORK_ROOT = '~/vl-parity-tilde';
  try {
    const shell = shellResolve('~/vl-parity-tilde');
    assert.strictEqual(shell.workDir, paths.getWorkRoot(PROJECT));
    assert.strictEqual(shell.dbPath, paths.getDbPath(PROJECT));
  } finally {
    if (saved === undefined) delete process.env.WORK_ROOT; else process.env.WORK_ROOT = saved;
  }
});

// 清理对拍过程中可能创建的空目录
try {
  const fs = require('fs');
  for (const d of ['vl-parity-abs', 'vl-parity-tilde']) {
    fs.rmSync(path.join(process.env.HOME, d), { recursive: true, force: true });
  }
} catch (_) {}

if (failures > 0) { console.error(`work-dir-parity.test.js: FAIL (${failures})`); process.exit(1); }
console.log('work-dir-parity.test.js: PASS');
