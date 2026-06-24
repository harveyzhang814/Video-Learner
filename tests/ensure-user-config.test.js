// tests/ensure-user-config.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureUserConfig, detectExistingData } = require('../cli/lib/ensure-user-config');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

async function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-euc-'));
  try { return await fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Force non-TTY so wizard skips prompts
const origIsTTY = process.stdin.isTTY;
Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

(async () => {

  // 1. Config created from example when missing
  await checkAsync('creates config from example when missing', async () => {
    await withTmp(async (dir) => {
      const cfgPath = path.join(dir, 'settings.conf');
      await ensureUserConfig({ configPath: cfgPath, configDir: dir });
      assert.ok(fs.existsSync(cfgPath), 'config file not created');
      const content = fs.readFileSync(cfgPath, 'utf8');
      assert.ok(content.includes('WORK_ROOT='), 'WORK_ROOT not written');
    });
  });

  // 2. Idempotent: does not overwrite existing config
  await checkAsync('does not overwrite existing config', async () => {
    await withTmp(async (dir) => {
      const cfgPath = path.join(dir, 'settings.conf');
      const original = 'WORK_ROOT=/my/custom/root\n';
      fs.writeFileSync(cfgPath, original, 'utf8');
      await ensureUserConfig({ configPath: cfgPath, configDir: dir });
      const content = fs.readFileSync(cfgPath, 'utf8');
      assert.strictEqual(content, original, 'existing config was overwritten');
    });
  });

  // 3. Default WORK_ROOT is ~/vdl-work
  await checkAsync('default WORK_ROOT is ~/vdl-work', async () => {
    await withTmp(async (dir) => {
      const cfgPath = path.join(dir, 'settings.conf');
      await ensureUserConfig({ configPath: cfgPath, configDir: dir });
      const content = fs.readFileSync(cfgPath, 'utf8');
      assert.ok(
        content.includes('WORK_ROOT=~/vdl-work') || content.includes(`WORK_ROOT=${os.homedir()}/vdl-work`),
        `expected ~/vdl-work in WORK_ROOT, got: ${content}`
      );
    });
  });

  // 4. detectExistingData: finds existing database.sqlite + task folders
  await checkAsync('detectExistingData finds existing database', async () => {
    await withTmp(async (dir) => {
      const workDir = path.join(dir, 'work');
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'database.sqlite'), '', 'utf8');
      fs.mkdirSync(path.join(workDir, 'abc123def456'));
      fs.mkdirSync(path.join(workDir, 'deadbeef0001'));
      const result = detectExistingData(dir);
      assert.strictEqual(result.found, true, 'found should be true');
      assert.strictEqual(result.hasDb, true, 'hasDb should be true');
      assert.strictEqual(result.taskCount, 2, `taskCount should be 2, got ${result.taskCount}`);
    });
  });

  // 5. detectExistingData: task folders only (no database.sqlite)
  await checkAsync('detectExistingData finds task folders without database', async () => {
    await withTmp(async (dir) => {
      const workDir = path.join(dir, 'work');
      fs.mkdirSync(workDir, { recursive: true });
      fs.mkdirSync(path.join(workDir, 'abc123def456'));
      const result = detectExistingData(dir);
      assert.strictEqual(result.found, true, 'found should be true');
      assert.strictEqual(result.hasDb, false, 'hasDb should be false');
      assert.strictEqual(result.taskCount, 1, `taskCount should be 1, got ${result.taskCount}`);
    });
  });

  // 6. detectExistingData: empty/missing work dir
  await checkAsync('detectExistingData returns not found for empty dir', async () => {
    await withTmp(async (dir) => {
      const result = detectExistingData(dir);
      assert.strictEqual(result.found, false, 'found should be false for missing work dir');
    });
  });

  Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });

  if (failures > 0) { console.error(`ensure-user-config.test.js: FAIL (${failures})`); process.exit(1); }
  console.log('ensure-user-config.test.js: PASS');
})();
