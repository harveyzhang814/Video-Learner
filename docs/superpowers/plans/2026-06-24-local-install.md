# Local Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vdl` work after deleting the repo by moving user config to `~/.config/vdl/settings.conf`, defaulting work data to `~/vdl-work`, and switching install from `npm link` (symlink) to `npm install -g .` (real copy).

**Architecture:** A new `core/user-config.js` exports path constants; `core/paths.js` reads config from `~/.config/vdl/settings.conf` (overridable via `VDL_CONFIG_FILE` env var for tests) instead of `scripts/settings.conf`. A new `scripts/user-config.sh` is the single shell-side authority; the three shell scripts that loaded `settings.conf` directly now source it instead. A first-run wizard in `cli/lib/ensure-user-config.js` creates the user config on first `vdl` invocation.

**Tech Stack:** Node.js (built-ins: `fs`, `path`, `os`, `readline`), bash, no new npm deps.

## Global Constraints

- No new npm dependencies.
- All tests run with `node tests/<file>.test.js` (no test framework).
- `VDL_CONFIG_FILE` env var overrides the user config path in both JS and shell — every test that touches config must use this to avoid touching the real `~/.config/vdl/settings.conf`.
- Shell scripts use `BASH_SOURCE[0]` (not `$0`) for `source`-safe path resolution.
- `rootDir` parameter kept in `core/paths.js` exports for API stability; it is no longer used for config file lookup.
- Commit on `feature/local-install` branch (already created).

---

### Task 1: `core/user-config.js` — path constants

**Files:**
- Create: `core/user-config.js`
- Create: `tests/user-config.test.js`

**Interfaces:**
- Produces: `USER_CONFIG_DIR` (`string` — `~/.config/vdl` resolved), `USER_CONFIG_PATH` (`string` — `USER_CONFIG_DIR/settings.conf`), `DEFAULT_WORK_ROOT` (`string` — `~/vdl-work` resolved). Consumed by Tasks 2, 5, 6.

- [ ] **Step 1: Write the failing test**

```js
// tests/user-config.test.js
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
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
node tests/user-config.test.js
```
Expected: `module loads` fails with "core/user-config.js not found".

- [ ] **Step 3: Create `core/user-config.js`**

```js
// core/user-config.js
'use strict';
const os = require('os');
const path = require('path');

const USER_CONFIG_DIR   = path.join(os.homedir(), '.config', 'vdl');
const USER_CONFIG_PATH  = path.join(USER_CONFIG_DIR, 'settings.conf');
const DEFAULT_WORK_ROOT = path.join(os.homedir(), 'vdl-work');

module.exports = { USER_CONFIG_DIR, USER_CONFIG_PATH, DEFAULT_WORK_ROOT };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
node tests/user-config.test.js
```
Expected: all 4 checks pass, `user-config.test.js: PASS`.

- [ ] **Step 5: Commit**

```bash
git add core/user-config.js tests/user-config.test.js
git commit -m "feat: add core/user-config.js with path constants"
```

---

### Task 2: Update `core/paths.js` — new config lookup chain

**Files:**
- Modify: `core/paths.js`
- Modify: `tests/work-dir-resolution.test.js`

**Interfaces:**
- Consumes: `USER_CONFIG_PATH`, `DEFAULT_WORK_ROOT` from `core/user-config.js` (Task 1).
- Produces: `resolveWorkBase(rootDir)` now reads config from `process.env.VDL_CONFIG_FILE || USER_CONFIG_PATH` instead of `<rootDir>/scripts/settings.conf`; falls back to `DEFAULT_WORK_ROOT` instead of `rootDir`.

- [ ] **Step 1: Update `core/paths.js`**

Add require at top (after existing requires):
```js
const { USER_CONFIG_PATH, DEFAULT_WORK_ROOT } = require('./user-config');
```

Replace the `resolveWorkBase` function body (lines 50–62) with:
```js
function resolveWorkBase(rootDir) {
  // rootDir retained for API compatibility; no longer used for config lookup.
  let raw = process.env.WORK_ROOT;
  if (!raw || !raw.trim()) {
    const cfgPath = process.env.VDL_CONFIG_FILE || USER_CONFIG_PATH;
    raw = readSettingValue(cfgPath, 'WORK_ROOT');
  }
  if (!raw || !raw.trim()) return DEFAULT_WORK_ROOT;
  const resolved = path.resolve(expandPath(raw));
  return resolved.replace(/\/+$/, '') || '/';
}
```

Update the JSDoc comment above it to:
```js
/**
 * Resolve the configurable WORK *root* (the parent under which "work/" lives).
 * Order: env WORK_ROOT > VDL_CONFIG_FILE (or ~/.config/vdl/settings.conf) WORK_ROOT > ~/vdl-work.
 * rootDir param retained for API compatibility; no longer used for config resolution.
 */
```

- [ ] **Step 2: Rewrite `tests/work-dir-resolution.test.js`**

The old test wrote to `<tmpdir>/scripts/settings.conf`. Replace the file entirely:

```js
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
```

- [ ] **Step 3: Run tests**

```bash
node tests/work-dir-resolution.test.js
```
Expected: all 11 checks pass.

- [ ] **Step 4: Commit**

```bash
git add core/paths.js tests/work-dir-resolution.test.js
git commit -m "feat: paths.js reads WORK_ROOT from ~/.config/vdl/settings.conf"
```

---

### Task 3: Shell scripts — `user-config.sh` + update three scripts

**Files:**
- Create: `scripts/user-config.sh`
- Modify: `scripts/work_dir.sh`
- Modify: `scripts/llm_engine.sh`
- Modify: `scripts/yt-dlp-cookies.sh`
- Modify: `tests/work-dir-parity.test.js`

**Interfaces:**
- Produces: `VDL_USER_CONFIG` variable (path of loaded config); all variables from the config file loaded into environment. `work_dir.sh` default changes from project dir to `$HOME/vdl-work`.

- [ ] **Step 1: Create `scripts/user-config.sh`**

```bash
#!/bin/bash
# scripts/user-config.sh — load user config into environment. SOURCE ONLY.
#
# Resolution order:
#   1. VDL_CONFIG_FILE env var (for testing / override)
#   2. ~/.config/vdl/settings.conf (persistent user config)
#
# After sourcing, all variables from the config file are available in the caller's env.

VDL_USER_CONFIG="${VDL_CONFIG_FILE:-$HOME/.config/vdl/settings.conf}"

if [ -f "$VDL_USER_CONFIG" ]; then
    # shellcheck source=/dev/null
    source "$VDL_USER_CONFIG"
fi
```

Make it non-executable (it's source-only):
```bash
chmod -x scripts/user-config.sh
```

- [ ] **Step 2: Replace `scripts/work_dir.sh`**

```bash
#!/bin/bash
# scripts/work_dir.sh — resolve the configurable work root/dir. SOURCE ONLY.
#
# Resolution (mirrors core/paths.js):
#   1. env WORK_ROOT (non-empty)
#   2. else WORK_ROOT from VDL_CONFIG_FILE or ~/.config/vdl/settings.conf
#   3. else ~/vdl-work
# Exports: WORK_ROOT, WORK_DIR (=<root>/work), DB_PATH (=<work>/database.sqlite).
# Ensures WORK_DIR exists.

_wd_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1+2: load user config only when env did not provide WORK_ROOT.
if [ -z "${WORK_ROOT:-}" ]; then
    # shellcheck source=/dev/null
    source "$_wd_script_dir/user-config.sh"
fi

# 3: default to ~/vdl-work.
if [ -z "${WORK_ROOT:-}" ]; then
    WORK_ROOT="$HOME/vdl-work"
fi

# Expand leading ~ (bash already expanded $VARs when sourcing settings.conf;
# an env-provided value is taken as-is except for ~).
case "$WORK_ROOT" in
    "~")   WORK_ROOT="$HOME" ;;
    "~/"*) WORK_ROOT="$HOME/${WORK_ROOT#\~/}" ;;
esac

# Strip trailing slashes.
while [ "${WORK_ROOT}" != "/" ] && [ "${WORK_ROOT%/}" != "${WORK_ROOT}" ]; do
    WORK_ROOT="${WORK_ROOT%/}"
done

WORK_DIR="$WORK_ROOT/work"
DB_PATH="$WORK_DIR/database.sqlite"
mkdir -p "$WORK_DIR"
export WORK_ROOT WORK_DIR DB_PATH
```

- [ ] **Step 3: Update `scripts/llm_engine.sh`**

Replace lines 5–11 (the `SETTINGS_FILE` block):

OLD:
```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS_FILE="$SCRIPT_DIR/settings.conf"

if [ -f "$SETTINGS_FILE" ]; then
  # shellcheck source=/dev/null
  source "$SETTINGS_FILE"
fi
```

NEW:
```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/user-config.sh"
```

- [ ] **Step 4: Update `scripts/yt-dlp-cookies.sh`**

Replace lines 8–13 (the `_ydc_dir/settings.conf` block):

OLD:
```bash
YT_DLP_COOKIE_OPTS=""
_ydc_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$_ydc_dir/settings.conf" ]; then
    # shellcheck source=settings.example.conf
    source "$_ydc_dir/settings.conf"
fi
```

NEW:
```bash
YT_DLP_COOKIE_OPTS=""
_ydc_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$_ydc_dir/user-config.sh"
```

- [ ] **Step 5: Update `tests/work-dir-parity.test.js`**

Replace the file entirely. The key changes: use `VDL_CONFIG_FILE=/dev/null` to isolate from real user config, and update the default expectation from project root to `~/vdl-work/work`.

```js
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
```

- [ ] **Step 6: Run both parity tests**

```bash
node tests/work-dir-parity.test.js
node tests/work-dir-resolution.test.js
```
Expected: both `PASS`.

- [ ] **Step 7: Commit**

```bash
git add scripts/user-config.sh scripts/work_dir.sh scripts/llm_engine.sh scripts/yt-dlp-cookies.sh tests/work-dir-parity.test.js
git commit -m "feat: shell scripts source user-config.sh; default work root ~/vdl-work"
```

---

### Task 4: Update `cli/commands/config.js` — write to user config

**Files:**
- Modify: `cli/commands/config.js`
- Modify: `tests/cli-config.test.js`

**Interfaces:**
- Consumes: `USER_CONFIG_PATH`, `DEFAULT_WORK_ROOT` from `core/user-config.js` (Task 1).
- `SETTINGS_PATH` now resolves to `process.env.VDL_CONFIG_FILE || USER_CONFIG_PATH`.

- [ ] **Step 1: Update `cli/commands/config.js`**

Replace lines 1–9 (the require block and ROOT_DIR/SETTINGS_PATH constants):

OLD:
```js
'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { writeWorkRoot, resolveWorkBase, getWorkRoot } = require('../../core/paths');

const ROOT_DIR = path.resolve(__dirname, '../..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'scripts', 'settings.conf');
```

NEW:
```js
'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { writeWorkRoot, resolveWorkBase, getWorkRoot } = require('../../core/paths');
const { USER_CONFIG_PATH, DEFAULT_WORK_ROOT } = require('../../core/user-config');

const ROOT_DIR = path.resolve(__dirname, '../..');
const SETTINGS_PATH = process.env.VDL_CONFIG_FILE || USER_CONFIG_PATH;
```

In the `run` function, update the `config get` output (lines ~163–168). The `isDefault` check changes from `workRoot === ROOT_DIR` to `workRoot === DEFAULT_WORK_ROOT`:

OLD:
```js
if (action === 'get') {
  const workRoot = resolveWorkBase(ROOT_DIR);
  const isDefault = workRoot === ROOT_DIR;
  process.stdout.write(`workRoot: ${isDefault ? '(default)' : workRoot}\n`);
  process.stdout.write(`workDir:  ${getWorkRoot(ROOT_DIR)}\n`);
  return;
}
```

NEW:
```js
if (action === 'get') {
  const workRoot = resolveWorkBase(ROOT_DIR);
  const isDefault = workRoot === DEFAULT_WORK_ROOT;
  process.stdout.write(`workRoot: ${isDefault ? '(default — ~/vdl-work)' : workRoot}\n`);
  process.stdout.write(`workDir:  ${getWorkRoot(ROOT_DIR)}\n`);
  process.stdout.write(`config:   ${SETTINGS_PATH}\n`);
  return;
}
```

At line ~206 (`writeWorkRoot(SETTINGS_PATH, value)`), this line already uses `SETTINGS_PATH` so no change needed there. But update the confirmation message:

OLD:
```js
process.stdout.write(`配置已写入: ${SETTINGS_PATH}\n`);
```

NEW:
```js
process.stdout.write(`配置已写入: ${SETTINGS_PATH}\n`);
```
(no change — SETTINGS_PATH is already the correct variable; it now resolves to the user config path)

- [ ] **Step 2: Update `tests/cli-config.test.js`**

The test currently tracks `scripts/settings.conf`. After the change it must use `VDL_CONFIG_FILE` to redirect writes to a tmpfile.

Replace lines 31–43 (the `SETTINGS` block):

OLD:
```js
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
```

NEW:
```js
// Use a fresh tmpfile for all config writes to avoid touching ~/.config/vdl/settings.conf
const os = require('os');
const TMP_CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-cli-cfg-'));
const TMP_CFG = path.join(TMP_CFG_DIR, 'settings.conf');
// VDL_CONFIG_FILE must be set in every runCli call that touches config
const CFG_ENV = { VDL_CONFIG_FILE: TMP_CFG };

function restoreSettings() {
  try { fs.unlinkSync(TMP_CFG); } catch (_) {}
}
```

Also update the `runCli` calls to spread `CFG_ENV`:

Update the `config get` test:
```js
check('config get shows (default) when no WORK_ROOT', () => {
  const { code, out } = runCli(['config', 'get'], { ...CFG_ENV, WORK_ROOT: '' });
  assert.strictEqual(code, 0, `exit code: ${out}`);
  assert.ok(out.includes('(default'), `expected "(default" in: ${out}`);
  assert.ok(out.includes('workDir'), `expected workDir in: ${out}`);
});
```

Update the `config set` test:
```js
check('config set work-root writes to user config file', () => {
  try {
    const { code, out } = runCli(
      ['config', 'set', 'work-root', '/tmp/vl-cli-config-test'],
      { ...CFG_ENV, WORK_ROOT: '' },
      'n\n'
    );
    assert.strictEqual(code, 0, `exit code: ${out}`);
    const content = fs.readFileSync(TMP_CFG, 'utf8');
    assert.ok(content.includes('WORK_ROOT=/tmp/vl-cli-config-test'), `settings not written: ${content}`);
  } finally {
    restoreSettings();
  }
});
```

- [ ] **Step 3: Run the test**

```bash
node tests/cli-config.test.js
```
Expected: all checks pass.

- [ ] **Step 3b: Apply `CFG_ENV` to all remaining `runCli` calls in the test file**

Any other `runCli` calls in `tests/cli-config.test.js` that touch config must also receive `{ ...CFG_ENV, ... }` in their env argument. Grep for `runCli(` in the file and add `...CFG_ENV` to each call's env object that isn't already covered.

- [ ] **Step 4: Commit**

```bash
git add cli/commands/config.js tests/cli-config.test.js
git commit -m "feat: vdl config reads/writes ~/.config/vdl/settings.conf"
```

---

### Task 5: `cli/lib/ensure-user-config.js` + first-run wizard

**Files:**
- Create: `cli/lib/ensure-user-config.js`
- Modify: `cli/index.js`
- Create: `tests/ensure-user-config.test.js`

**Interfaces:**
- Produces: `ensureUserConfig({ configPath?, configDir? })` — async function. Idempotent: returns immediately if config already exists.
- Consumes: `USER_CONFIG_DIR`, `USER_CONFIG_PATH`, `DEFAULT_WORK_ROOT` from `core/user-config.js`; `writeWorkRoot` from `core/paths.js`.

- [ ] **Step 1: Create `cli/lib/ensure-user-config.js`**

```js
// cli/lib/ensure-user-config.js
'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const os   = require('os');
const { USER_CONFIG_DIR, USER_CONFIG_PATH, DEFAULT_WORK_ROOT } = require('../../core/user-config');
const { writeWorkRoot } = require('../../core/paths');

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function detectExistingData(workRoot) {
  const workDir = path.join(workRoot, 'work');
  const dbPath  = path.join(workDir, 'database.sqlite');
  if (fs.existsSync(dbPath)) {
    let taskCount = 0;
    try {
      taskCount = fs.readdirSync(workDir)
        .filter(n => /^[0-9a-f]{12}$/.test(n)).length;
    } catch (_) {}
    return { found: true, hasDb: true, taskCount };
  }
  try {
    const taskFolders = fs.readdirSync(workDir)
      .filter(n => /^[0-9a-f]{12}$/.test(n));
    if (taskFolders.length > 0) return { found: true, hasDb: false, taskCount: taskFolders.length };
  } catch (_) {}
  return { found: false };
}

function promptLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function ensureUserConfig({
  configPath = USER_CONFIG_PATH,
  configDir  = USER_CONFIG_DIR,
} = {}) {
  if (fs.existsSync(configPath)) return;

  // Read template from installed scripts directory
  const examplePath = path.join(__dirname, '../../scripts/settings.example.conf');
  let exampleContent = '';
  try { exampleContent = fs.readFileSync(examplePath, 'utf8'); } catch (_) {}

  let workRootRaw = '~/vdl-work';
  let workRootAbs = DEFAULT_WORK_ROOT;

  if (process.stdin.isTTY) {
    const defaultDisplay = DEFAULT_WORK_ROOT.replace(os.homedir(), '~');
    process.stdout.write('\nWelcome to vdl! Setting up your config...\n');
    const ans = await promptLine(
      `Work root [${defaultDisplay}]:\n  (tasks will be stored under <work root>/work/)\n> `
    );
    if (ans) {
      workRootRaw = ans;
      workRootAbs = path.resolve(expandHome(ans));
    }

    const detection = detectExistingData(workRootAbs);
    process.stdout.write(`\nChecking ${path.join(workRootAbs, 'work')}/ ...\n`);
    if (detection.found && detection.hasDb) {
      const n = detection.taskCount;
      process.stdout.write(
        `✓ Found existing data (database.sqlite + ${n} task folder${n !== 1 ? 's' : ''}) — will be loaded automatically.\n`
      );
    } else if (detection.found) {
      process.stdout.write(`✓ Found existing task folders — will be loaded automatically.\n`);
    } else {
      process.stdout.write(`✓ New work directory will be created at ${path.join(workRootAbs, 'work')}/\n`);
    }
  }

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, exampleContent, 'utf8');
  writeWorkRoot(configPath, workRootRaw);

  if (process.stdin.isTTY) {
    process.stdout.write(`\n✓ Config created: ${configPath}\n`);
    process.stdout.write(`✓ Data directory:  ${path.join(workRootAbs, 'work')}/\n\n`);
  }
}

module.exports = { ensureUserConfig };
```

- [ ] **Step 2: Write the test**

```js
// tests/ensure-user-config.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureUserConfig } = require('../cli/lib/ensure-user-config');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-euc-'));
  try { return fn(dir); }
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

  // 4. detectExistingData: finds existing database.sqlite
  await checkAsync('detectExistingData finds existing database', async () => {
    await withTmp(async (dir) => {
      const workDir = path.join(dir, 'work');
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(path.join(workDir, 'database.sqlite'), '', 'utf8');
      fs.mkdirSync(path.join(workDir, 'abc123def456'));
      // Run wizard in non-TTY; it should still create the config
      const cfgPath = path.join(dir, 'cfg.conf');
      await ensureUserConfig({ configPath: cfgPath, configDir: dir });
      assert.ok(fs.existsSync(cfgPath));
    });
  });

  Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });

  if (failures > 0) { console.error(`ensure-user-config.test.js: FAIL (${failures})`); process.exit(1); }
  console.log('ensure-user-config.test.js: PASS');
})();
```

- [ ] **Step 3: Run the test**

```bash
node tests/ensure-user-config.test.js
```
Expected: all 4 checks pass.

- [ ] **Step 4: Wire into `cli/index.js`**

Add require and call at the top of `cli/index.js`, before the command dispatch. Insert after the existing `'use strict';` line:

```js
'use strict';

const { ensureUserConfig } = require('./lib/ensure-user-config');

const args = process.argv.slice(2);
const sub = args[0];

// ... (rest of commands object unchanged)
```

Then wrap the entire dispatch in an async IIFE that first calls `ensureUserConfig`:

Replace the bottom of `cli/index.js` (from `if (!sub || ...)` to end) with:

```js
(async () => {
  // Skip first-run wizard for --help / -h
  if (sub && sub !== '--help' && sub !== '-h') {
    await ensureUserConfig();
  }

  if (!sub || sub === '--help' || sub === '-h') {
    printUsage();
    process.exit(0);
  }

  if (commands[sub]) {
    commands[sub]().catch(err => {
      require('./lib/format').printError(err.message);
      process.exit(1);
    });
  } else if (sub.startsWith('http') || sub.startsWith('-')) {
    require('./commands/run').run(args).catch(err => {
      require('./lib/format').printError(err.message);
      process.exit(1);
    });
  } else {
    process.stderr.write(`Unknown command: ${sub}\n`);
    printUsage();
    process.exit(1);
  }
})();
```

- [ ] **Step 5: Verify `vdl --help` still works**

```bash
node cli/index.js --help
```
Expected: usage text printed, no wizard output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add cli/lib/ensure-user-config.js cli/index.js tests/ensure-user-config.test.js
git commit -m "feat: first-run wizard creates ~/.config/vdl/settings.conf"
```

---

### Task 6: Docs and settings template updates

**Files:**
- Modify: `docs/how-to/cli.md`
- Modify: `docs/how-to/deploy.md`
- Modify: `scripts/settings.example.conf`
- Modify: `cli/index.js` (usage text only)

- [ ] **Step 1: Update `docs/how-to/cli.md`**

Replace the **安装** section:

OLD:
```markdown
## 安装

```bash
cd /path/to/Video-Learner
npm link          # 全局注册 vdl
```
```

NEW:
```markdown
## 安装

```bash
cd /path/to/Video-Learner
npm install -g .    # 全局安装（真实拷贝，删仓库后 vdl 仍可运行）
```

首次运行任意 `vdl` 命令时，会自动创建 `~/.config/vdl/settings.conf` 并询问数据目录（默认 `~/vdl-work`）。
```

Replace the **卸载** section:

OLD:
```markdown
## 卸载

```bash
npm unlink vdl
```
```

NEW:
```markdown
## 卸载

```bash
npm uninstall -g video-learner
```
```

- [ ] **Step 2: Update `docs/how-to/deploy.md` section 2**

Replace the `## 2. 必做：本地配置文件 scripts/settings.conf` section header and content:

OLD heading:
```markdown
## 2. 必做：本地配置文件 `scripts/settings.conf`

`scripts/settings.conf` **不在 Git 中**（见根目录 `.gitignore`），克隆后必须自行创建：

```bash
cp scripts/settings.example.conf scripts/settings.conf
```
```

NEW:
```markdown
## 2. 本地配置文件 `~/.config/vdl/settings.conf`

首次运行 `vdl` 命令时，向导自动从内置模板创建 `~/.config/vdl/settings.conf`，无需手动复制。

若需提前手动创建：

```bash
mkdir -p ~/.config/vdl
cp /opt/homebrew/lib/node_modules/video-learner/scripts/settings.example.conf ~/.config/vdl/settings.conf
```
```

Also update the line `scripts/yt-dlp-cookies.sh 会在调用 yt-dlp 的脚本中自动读取 settings.conf 中的 Cookie 配置。` to:
```markdown
`scripts/yt-dlp-cookies.sh` 会在调用 yt-dlp 的脚本中自动读取 `~/.config/vdl/settings.conf` 中的 Cookie 配置。
```

Update section 5 (`work/` location sentence):

OLD:
```
运行时数据位于 **`work/`**（默认在仓库根下）：
```

NEW:
```
运行时数据位于 **`~/vdl-work/work/`**（默认；可在 `~/.config/vdl/settings.conf` 通过 `WORK_ROOT` 修改）：
```

- [ ] **Step 3: Update `scripts/settings.example.conf` WORK_ROOT comment**

Replace the WORK_ROOT block at the bottom:

OLD:
```bash
# work 根目录（任务产物与 SQLite 数据库的存放位置的父目录）
# 留空 = 默认存放在项目目录下的 work/。
# 设为绝对路径（支持 ~ 展开）可将 work/ 移到项目外，例如 Syncthing 共享目录。
# 实际目录为 <WORK_ROOT>/work，例如下例会用 ~/Syncthing/video-learner/work
# WORK_ROOT=~/Syncthing/video-learner
```

NEW:
```bash
# work 根目录（任务产物与 SQLite 数据库的存放位置的父目录）
# 留空 = 默认存放在 ~/vdl-work/work/。
# 设为绝对路径（支持 ~ 展开）可将 work/ 移到指定目录，例如 Syncthing 共享目录。
# 实际目录为 <WORK_ROOT>/work，例如下例会用 ~/Syncthing/video-learner/work
# WORK_ROOT=~/Syncthing/video-learner
```

- [ ] **Step 4: Update `cli/index.js` help text**

Find the line:
```
vdl config set work-root <path>
                   持久化写入 scripts/settings.conf，重启后端生效
```

Replace with:
```
vdl config set work-root <path>
                     持久化写入 ~/.config/vdl/settings.conf，重启后端生效
```

- [ ] **Step 5: Commit**

```bash
git add docs/how-to/cli.md docs/how-to/deploy.md scripts/settings.example.conf cli/index.js
git commit -m "docs: update install instructions and config file references"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run the full test suite relevant to these changes**

```bash
node tests/user-config.test.js && \
node tests/work-dir-resolution.test.js && \
node tests/work-dir-parity.test.js && \
node tests/cli-config.test.js && \
node tests/ensure-user-config.test.js
```
Expected: all PASS.

- [ ] **Step 2: Smoke-test `vdl config get` in a non-interactive environment**

```bash
node cli/index.js config get
```
Expected: output includes `workRoot`, `workDir`, and `config: .../.config/vdl/settings.conf`. If `~/.config/vdl/settings.conf` does not yet exist on this machine, the wizard runs (non-TTY: silently creates with defaults); if it exists, config get output is shown directly.

- [ ] **Step 3: Verify install path independence with `npm install -g .`**

```bash
# From repo root
npm install -g .
# Confirm symlink is gone
ls -la /opt/homebrew/lib/node_modules/video-learner
# Expected: a real directory, not a symlink arrow (lrwxr-xr-x)
which vdl && vdl config get
```
Expected: `vdl` resolves, `config get` shows `~/.config/vdl/settings.conf`.

- [ ] **Step 4: Final commit (if any loose files)**

```bash
git status
# If clean, nothing to do. If any files changed, commit them.
```
