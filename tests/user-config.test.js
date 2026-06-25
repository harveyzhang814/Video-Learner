'use strict';
const assert = require('assert');
const os = require('os');
const path = require('path');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// Module not created yet — require will throw
let uc;
try { uc = require('../core/user-config'); } catch (_) { uc = null; }

check('module loads', () => { assert.ok(uc, 'core/user-config.js not found'); });
check('USER_CONFIG_DIR under homedir/.config/vdl', () => {
  assert.strictEqual(uc.USER_CONFIG_DIR, path.join(os.homedir(), '.config', 'vdl'));
});
check('USER_CONFIG_PATH is settings.conf in USER_CONFIG_DIR', () => {
  assert.strictEqual(uc.USER_CONFIG_PATH, path.join(uc.USER_CONFIG_DIR, 'settings.conf'));
});
check('DEFAULT_WORK_ROOT is ~/vdl-work resolved', () => {
  assert.strictEqual(uc.DEFAULT_WORK_ROOT, path.join(os.homedir(), 'vdl-work'));
});

if (failures > 0) { console.error(`user-config.test.js: FAIL (${failures})`); process.exit(1); }
console.log('user-config.test.js: PASS');
