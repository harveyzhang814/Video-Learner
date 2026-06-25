// tests/work-dir-parity.test.js
'use strict';

/**
 * Parity: scripts/work_dir.sh and core/paths.js must resolve identical
 * WORK_DIR / DB_PATH for the same inputs. Guards against drift between the
 * two independent resolvers.
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const paths = require('../core/paths');
const { DEFAULT_WORK_ROOT } = require('../core/user-config');

const PROJECT = path.resolve(__dirname, '..');
const NO_CONFIG = '/dev/null';   // VDL_CONFIG_FILE that has no WORK_ROOT

function shellResolve(envWorkRoot, vdlConfigFile) {
  const env = { ...process.env };
  if (envWorkRoot === null) delete env.WORK_ROOT;
  else env.WORK_ROOT = envWorkRoot;
  env.VDL_CONFIG_FILE = vdlConfigFile ?? NO_CONFIG;
  const out = execFileSync(
    'bash',
    ['-c', 'source "$0"; printf "%s\\n%s\\n" "$WORK_DIR" "$DB_PATH"',
     path.join(PROJECT, 'scripts', 'work_dir.sh')],
    { env, encoding: 'utf8' }
  );
  const [workDir, dbPath] = out.trim().split('\n');
  return { workDir, dbPath };
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

// 1. Default — both resolve to ~/vdl-work/work
check('default parity (~/vdl-work/work)', () => {
  delete process.env.WORK_ROOT;
  process.env.VDL_CONFIG_FILE = NO_CONFIG;
  const shell = shellResolve(null);
  const expectedWorkDir = path.join(DEFAULT_WORK_ROOT, 'work');
  const expectedDbPath  = path.join(expectedWorkDir, 'database.sqlite');
  assert.strictEqual(shell.workDir, expectedWorkDir, `shell WORK_DIR mismatch: ${shell.workDir}`);
  assert.strictEqual(shell.dbPath, expectedDbPath,  `shell DB_PATH mismatch`);
  assert.strictEqual(paths.getWorkRoot(PROJECT), expectedWorkDir, `JS getWorkRoot mismatch`);
  assert.strictEqual(paths.getDbPath(PROJECT),  expectedDbPath,  `JS getDbPath mismatch`);
});

// 2. env absolute path parity
check('env absolute parity', () => {
  const target = path.join(os.homedir(), 'vl-parity-abs');
  process.env.WORK_ROOT = target;
  process.env.VDL_CONFIG_FILE = NO_CONFIG;
  const shell = shellResolve(target);
  assert.strictEqual(shell.workDir, paths.getWorkRoot(PROJECT), `WORK_DIR mismatch`);
  assert.strictEqual(shell.dbPath, paths.getDbPath(PROJECT),  `DB_PATH mismatch`);
});

// 3. env ~ expansion parity
check('env tilde parity', () => {
  process.env.WORK_ROOT = '~/vl-parity-tilde';
  process.env.VDL_CONFIG_FILE = NO_CONFIG;
  const shell = shellResolve('~/vl-parity-tilde');
  assert.strictEqual(shell.workDir, paths.getWorkRoot(PROJECT), `WORK_DIR mismatch`);
  assert.strictEqual(shell.dbPath, paths.getDbPath(PROJECT),  `DB_PATH mismatch`);
});

// cleanup dirs created by mkdir -p inside work_dir.sh
try {
  const fs = require('fs');
  for (const d of ['vl-parity-abs', 'vl-parity-tilde']) {
    fs.rmSync(path.join(os.homedir(), d, 'work'), { recursive: true, force: true });
    try { fs.rmdirSync(path.join(os.homedir(), d)); } catch (_) {}
  }
  // cleanup default work dir created during test 1
  fs.rmSync(path.join(DEFAULT_WORK_ROOT, 'work'), { recursive: true, force: true });
  try { fs.rmdirSync(DEFAULT_WORK_ROOT); } catch (_) {}
} catch (_) {}

if (failures > 0) { console.error(`work-dir-parity.test.js: FAIL (${failures})`); process.exit(1); }
console.log('work-dir-parity.test.js: PASS');
