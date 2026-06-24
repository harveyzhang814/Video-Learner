'use strict';

/**
 * Smoke test: pack the project as a tarball, install it into a temp prefix,
 * and run `config get` from a directory OUTSIDE the repository. Verifies:
 *   1. better-sqlite3 (and all prod deps) land in the installed copy
 *   2. `config get` exits 0 — no MODULE_NOT_FOUND crash
 *   3. Config path in output is ~/.config/vdl/settings.conf, not a repo-relative path
 *
 * Slow (~30-60 s). Run standalone: node tests/global-install-smoke.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const PROJECT = path.resolve(__dirname, '..');
const EXPECTED_CONFIG = path.join(os.homedir(), '.config', 'vdl', 'settings.conf');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

let prefix = null;
let tarball = null;
let runDir = null;

try {
  console.log('  packing…');
  const packJson = execSync('npm pack --json', { cwd: PROJECT, encoding: 'utf8' });
  const filename = JSON.parse(packJson)[0].filename;
  tarball = path.join(PROJECT, filename);

  console.log('  installing to temp prefix…');
  prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-smoke-'));
  execSync(`npm install -g --prefix "${prefix}" "${tarball}"`, {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const installedCli = path.join(
    prefix, 'lib', 'node_modules', 'video-learner', 'cli', 'index.js'
  );
  runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-run-'));

  check('cli/index.js present in installed copy', () => {
    assert.ok(fs.existsSync(installedCli), `not found: ${installedCli}`);
  });

  // Run config get from a directory that is NOT the repo.
  // stdin is piped (not inherited) → process.stdin.isTTY = false → no wizard prompt.
  function runConfigGet() {
    return spawnSync(process.execPath, [installedCli, 'config', 'get'], {
      cwd: runDir,
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  check('config get exits 0 (all prod deps resolvable)', () => {
    const r = runConfigGet();
    assert.ok(
      !r.stderr.includes('MODULE_NOT_FOUND'),
      `MODULE_NOT_FOUND in stderr:\n${r.stderr.slice(0, 300)}`
    );
    assert.strictEqual(r.status, 0,
      `exited with ${r.status}\nstderr: ${r.stderr.slice(0, 300)}`
    );
  });

  check('config path is ~/.config/vdl/settings.conf, not a repo path', () => {
    const r = runConfigGet();
    assert.ok(
      r.stdout.includes(EXPECTED_CONFIG),
      `expected "${EXPECTED_CONFIG}" in output:\n${r.stdout}`
    );
    assert.ok(
      !r.stdout.includes(PROJECT),
      `output references original repo path:\n${r.stdout}`
    );
  });

} finally {
  if (runDir)  try { fs.rmSync(runDir,  { recursive: true, force: true }); } catch (_) {}
  if (prefix)  try { fs.rmSync(prefix,  { recursive: true, force: true }); } catch (_) {}
  if (tarball) try { fs.unlinkSync(tarball); } catch (_) {}
}

if (failures > 0) {
  console.error(`global-install-smoke.test.js: FAIL (${failures})`);
  process.exit(1);
}
console.log('global-install-smoke.test.js: PASS');
