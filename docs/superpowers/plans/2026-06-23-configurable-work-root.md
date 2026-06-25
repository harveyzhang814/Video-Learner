# 支持配置 work 根目录路径（WORK_ROOT）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `work/` 目录可通过 `WORK_ROOT` 配置项指向项目外的根目录（如 Syncthing 共享目录），默认行为完全不变。

**Architecture:** 引入一个可配置的**根目录** `WORK_ROOT`，真正的工作目录为 `<WORK_ROOT>/work`。Node 侧把解析逻辑集中到既有的 `core/paths.js`（其 `getWorkRoot(rootDir)` 已是全局唯一入口）；Shell 侧新增 `scripts/work_dir.sh` 助手，被 `scripts/db.sh` source。两端解析规则等价：`env WORK_ROOT` > `<rootDir>/scripts/settings.conf` 的 `WORK_ROOT` > `rootDir`。Node 通过 `spawnEnv` 把解析好的 `WORK_ROOT` 注入子进程，保证两端路径一致。

**Tech Stack:** Node.js (CommonJS, better-sqlite3)、Bash、无测试框架（`node tests/*.test.js`）。

## Global Constraints

- **解析规则（两端必须等价）：** 1) 环境变量 `WORK_ROOT`（非空）；2) 否则 `<rootDir>/scripts/settings.conf` 中的 `WORK_ROOT`（非空）；3) 否则默认 `rootDir`。
- **路径规范化：** 展开前导 `~`（→ `$HOME`）与 `$VAR`/`${VAR}`；解析为**绝对路径**；去掉末尾斜杠；空字符串视为未设置。
- **最终工作目录：** `workDir = <resolvedRoot>/work`；`dbPath = <resolvedRoot>/work/database.sqlite`；`indexPath = <resolvedRoot>/work/index.jsonl`。
- **向后兼容：** 未配置 `WORK_ROOT` 时，所有路径与今天逐字节相同（`<rootDir>/work/...`）。
- **测试隔离：** `settings.conf` 按 `<rootDir>/scripts/settings.conf` 读取。测试传入 tmp `rootDir`（无 `scripts/settings.conf`），因此永不被生产配置覆盖。
- **work 子目录存在性：** 打开 SQLite 前必须 `mkdir -p <resolvedRoot>/work`（Node 侧由 `db.js` 既有的 `fs.mkdirSync(path.dirname(dbPath), {recursive:true})` 覆盖；Shell 侧由 `work_dir.sh` 的 `mkdir -p` 覆盖）。
- **分支：** 已在 worktree `feature/configurable-work-root`（从 `staging` 切出）。
- **提交信息结尾：** 每次 commit 末尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

## File Structure

| 文件 | 角色 | 改动 |
|------|------|------|
| `core/paths.js` | Node 单一解析权威 | 新增解析逻辑 + `getDbPath`/`getIndexPath`/`resolveWorkBase`，修改 `getWorkRoot` |
| `core/orchestrator/db.js` | DB 路径 | `getDbPath` 委托给 `core/paths.js` |
| `core/orchestrator/index.js` | 任务工作目录 + 子进程 env | `getWorkDir`/`appendIndex` 委托；`spawnEnv` 注入 `WORK_ROOT` |
| `core/orchestrator/stepArtifacts.js` | 任务目录校验 | `getTaskDir` + work 校验委托 |
| `services/http-server/index.js` | HTTP 静态/媒体路径 | 6 处 `path.resolve(ROOT_DIR,'work',...)` 改用 `getWorkRoot` |
| `services/http-server/reveal.js` | 文件定位 | 1 处委托 |
| `cli/commands/run.js` | CLI 结果路径 | 委托 |
| `cli/commands/list.js` | CLI list DB 路径 | 委托 |
| `scripts/work_dir.sh` | **新增** Shell 解析助手 | source-only，导出 `WORK_ROOT`/`WORK_DIR`/`DB_PATH` |
| `scripts/db.sh` | Shell DB 入口 | source `work_dir.sh` 取默认 `DB_PATH` |
| `scripts/{fetch_info,download_subs,download_video,generate_article,generate_summary}.sh` | 各步骤脚本 | 删除已失效的 `DB_PATH=...` 行 |
| `scripts/{generate_article,generate_summary}.sh` | 写作脚本 | 任务 ID 正则加固 |
| `scripts/settings.conf` / `settings.example.conf` | 配置 | 新增 `WORK_ROOT=` |
| `docs/how-to/configure-work-dir.md` | **新增** 文档 | 迁移指引 + Syncthing/SQLite 警告 |
| `tests/work-dir-resolution.test.js` | **新增** | `core/paths.js` 解析单测 |
| `tests/work-dir-parity.test.js` | **新增** | Node↔Shell 解析对拍 |

**非目标（不改）：** `scripts/opencode_server.sh`（pid 文件，非任务产物）、`scripts/test_e2e.sh`/`test_full_e2e.sh`（dev/test harness）、`scripts/ingest_task_logs.js`（仅文档注释；其路径参数由 Node 传入已解析的绝对路径）。

---

## Task 1: Node 解析核心（`core/paths.js`）

**Files:**
- Modify: `core/paths.js`
- Test: `tests/work-dir-resolution.test.js` (create)

**Interfaces:**
- Produces:
  - `resolveWorkBase(rootDir: string): string` — 返回解析后的**根目录绝对路径**（env/settings/rootDir）。
  - `getWorkRoot(rootDir: string): string` — 返回 `<resolveWorkBase>/work`（保持既有契约：返回含各任务目录的工作目录）。
  - `getTaskDirs(rootDir, taskId)` — 不变（内部走 `getWorkRoot`）。
  - `getDbPath(rootDir: string): string` — `<workRoot>/database.sqlite`。
  - `getIndexPath(rootDir: string): string` — `<workRoot>/index.jsonl`。

- [ ] **Step 1: 写失败测试**

创建 `tests/work-dir-resolution.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node tests/work-dir-resolution.test.js`
Expected: FAIL（`paths.resolveWorkBase is not a function`）

- [ ] **Step 3: 实现 `core/paths.js`**

将 `core/paths.js` 完整替换为：

```js
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Expand a leading ~ and $VAR / ${VAR} references against process.env.
 */
function expandPath(value) {
  let out = String(value).trim();
  if (out === '~') {
    out = process.env.HOME || out;
  } else if (out.startsWith('~/')) {
    out = path.join(process.env.HOME || '', out.slice(2));
  }
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => {
    const name = a || b;
    return process.env[name] != null ? process.env[name] : '';
  });
  return out;
}

/**
 * Read a single KEY=value from a bash-style settings file (last assignment wins,
 * surrounding quotes stripped). Returns null if file missing or key absent/empty.
 */
function readSettingValue(settingsPath, key) {
  let text;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch (_) {
    return null;
  }
  let val = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && m[1] === key) val = m[2];
  }
  if (val == null) return null;
  val = val.replace(/^["']/, '').replace(/["']$/, '');
  return val;
}

/**
 * Resolve the configurable WORK *root* (the parent under which "work/" lives).
 * Order: env WORK_ROOT > <rootDir>/scripts/settings.conf WORK_ROOT > rootDir.
 */
function resolveWorkBase(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('resolveWorkBase requires a non-empty rootDir string');
  }
  const base = path.resolve(rootDir);
  let raw = process.env.WORK_ROOT;
  if (!raw || !raw.trim()) {
    raw = readSettingValue(path.join(base, 'scripts', 'settings.conf'), 'WORK_ROOT');
  }
  if (!raw || !raw.trim()) return base;
  const resolved = path.resolve(expandPath(raw));
  return resolved.replace(/\/+$/, '') || '/';
}

/**
 * Absolute work directory: "<resolvedRoot>/work". All per-task folders live here.
 */
function getWorkRoot(rootDir) {
  return path.join(resolveWorkBase(rootDir), 'work');
}

/**
 * Absolute path to the SQLite database.
 */
function getDbPath(rootDir) {
  return path.join(getWorkRoot(rootDir), 'database.sqlite');
}

/**
 * Absolute path to the audit index.jsonl.
 */
function getIndexPath(rootDir) {
  return path.join(getWorkRoot(rootDir), 'index.jsonl');
}

/**
 * Compute key task directories under the work root.
 *   <workRoot>/<taskId>/{media,transcript,writing}, plus notes.json
 */
function getTaskDirs(rootDir, taskId) {
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('getTaskDirs requires a non-empty taskId string');
  }
  const workRoot = getWorkRoot(rootDir);
  const base = path.join(workRoot, taskId);
  return {
    base,
    media:      path.join(base, 'media'),
    transcript: path.join(base, 'transcript'),
    writing:    path.join(base, 'writing'),
    notes:      path.join(base, 'notes.json'),
  };
}

module.exports = {
  resolveWorkBase,
  getWorkRoot,
  getDbPath,
  getIndexPath,
  getTaskDirs,
};
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node tests/work-dir-resolution.test.js`
Expected: `work-dir-resolution.test.js: PASS`

- [ ] **Step 5: 提交**

```bash
git add core/paths.js tests/work-dir-resolution.test.js
git commit -m "feat(paths): resolve configurable WORK_ROOT in core/paths.js

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 接入所有 Node 消费方 + 子进程注入

**Files:**
- Modify: `core/orchestrator/db.js:7-9`
- Modify: `core/orchestrator/index.js:144-156`, `spawnEnv` (≈438-443) 及其两处调用（≈458、≈1234）
- Modify: `core/orchestrator/stepArtifacts.js:10-12, 37`
- Modify: `services/http-server/index.js:359-360, 416, 459, 637`
- Modify: `services/http-server/reveal.js:22`
- Modify: `cli/commands/run.js:111`
- Modify: `cli/commands/list.js:5`

**Interfaces:**
- Consumes: `core/paths.js` 的 `getWorkRoot(rootDir)`、`getDbPath(rootDir)`、`getIndexPath(rootDir)`、`resolveWorkBase(rootDir)`。

- [ ] **Step 1: `db.js` getDbPath 委托**

`core/orchestrator/db.js` 顶部 `require` 区加入：

```js
const { getDbPath: resolveDbPath } = require('../paths');
```

将：

```js
function getDbPath(rootDir) {
  return path.join(rootDir, 'work', 'database.sqlite');
}
```

替换为：

```js
function getDbPath(rootDir) {
  return resolveDbPath(rootDir);
}
```

（`createDb` 中既有的 `fs.mkdirSync(path.dirname(dbPath), { recursive: true })` 自动保证新 work 目录存在，无需改动。）

- [ ] **Step 2: `index.js` getWorkDir / appendIndex 委托 + spawnEnv 注入**

`core/orchestrator/index.js` 顶部加入（注意：`index.js` 在 `core/orchestrator/`，`paths.js` 在 `core/`，故为 `require('../paths')`）：

```js
const { getWorkRoot, getIndexPath, resolveWorkBase } = require('../paths');
```

将：

```js
function getWorkDir(rootDir, id) {
  return path.join(rootDir, 'work', id);
}
```

替换为：

```js
function getWorkDir(rootDir, id) {
  return path.join(getWorkRoot(rootDir), id);
}
```

将 `appendIndex` 中：

```js
  const indexPath = path.join(rootDir, 'work', 'index.jsonl');
```

替换为：

```js
  const indexPath = getIndexPath(rootDir);
```

将 `spawnEnv`：

```js
function spawnEnv() {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
  const pathList = [process.env.PATH, ...extra].filter(Boolean);
  const PATH = [...new Set(pathList.join(':').split(':'))].filter(Boolean).join(':');
  return { ...process.env, PATH };
}
```

替换为（新增 `rootDir` 参数并注入 `WORK_ROOT`）：

```js
function spawnEnv(rootDir) {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
  const pathList = [process.env.PATH, ...extra].filter(Boolean);
  const PATH = [...new Set(pathList.join(':').split(':'))].filter(Boolean).join(':');
  const env = { ...process.env, PATH };
  if (rootDir) env.WORK_ROOT = resolveWorkBase(rootDir);
  return env;
}
```

将两处调用 `env: spawnEnv()` 改为 `env: spawnEnv(rootDir)`（`runStepScript` 内 ≈458 行、stop-if-started spawn ≈1234 行，两处上下文均有 `rootDir` 变量在作用域内）。

- [ ] **Step 3: `stepArtifacts.js` 委托**

`core/orchestrator/stepArtifacts.js` 顶部加入：

```js
const { getWorkRoot } = require('../paths');
```

将：

```js
function getTaskDir(rootDir, id) {
  return path.join(rootDir, 'work', id);
}
```

替换为：

```js
function getTaskDir(rootDir, id) {
  return path.join(getWorkRoot(rootDir), id);
}
```

将（≈37 行）：

```js
    const workDir = path.join(absRoot, 'work');
```

替换为：

```js
    const workDir = getWorkRoot(absRoot);
```

- [ ] **Step 4: `services/http-server/index.js` 媒体/静态路径委托**

`services/http-server/index.js` 已 `require('../../core/paths')` 取 `getTaskDirs`，扩展为同时引入 `getWorkRoot`：

```js
const { getTaskDirs, getWorkRoot } = require('../../core/paths');
```

将以下 5 处的 `path.resolve(ROOT_DIR, 'work', ...)` / `path.join(ROOT_DIR, 'work')` 改为以 `getWorkRoot(ROOT_DIR)` 为基：

- `:28`  `migrateModeName(path.join(ROOT_DIR, 'work'));` → `migrateModeName(getWorkRoot(ROOT_DIR));`
- `:359` `path.resolve(ROOT_DIR, 'work', taskIdInMeta, 'media', 'video.mp4')` → `path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'media', 'video.mp4')`
- `:360` 同理 `audio.m4a`
- `:416` `path.resolve(ROOT_DIR, 'work', taskIdInMeta, 'media', filename)` → `path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'media', filename)`
- `:459` `path.resolve(ROOT_DIR, 'work', taskIdInMeta, 'transcript')` → `path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'transcript')`
- `:637` `path.resolve(ROOT_DIR, 'work', taskIdInMeta, 'writing')` → `path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'writing')`

> 这些路径随后用于 `path.resolve` 安全校验比对，必须与实际写入路径同源（均经 `getWorkRoot`），改后语义一致。

- [ ] **Step 5: `reveal.js` 委托**

`services/http-server/reveal.js` 顶部加入：

```js
const { getWorkRoot } = require('../../core/paths');
```

将（≈22 行）：

```js
    const dir = path.join(rootDir, 'work', taskId);
```

替换为：

```js
    const dir = path.join(getWorkRoot(rootDir), taskId);
```

- [ ] **Step 6: CLI 两处委托**

`cli/commands/run.js` 顶部加入：

```js
const { getWorkRoot } = require('../../core/paths');
```

将（≈111 行）：

```js
  const workDir = path.resolve(__dirname, '../../work', taskId);
```

替换为：

```js
  const workDir = path.join(getWorkRoot(path.resolve(__dirname, '../..')), taskId);
```

`cli/commands/list.js` 将：

```js
const DB_PATH = path.resolve(__dirname, '../../work/database.sqlite');
```

替换为：

```js
const { getDbPath } = require('../../core/paths');
const DB_PATH = getDbPath(path.resolve(__dirname, '../..'));
```

- [ ] **Step 7: 运行 Node 回归套件**

Run: `npm run test:agent:core && npm run test:orchestrator:unit && npm run test:reset-scope`
Expected: 全部 PASS（未配置 `WORK_ROOT` 时行为不变；tmp rootDir 无 `scripts/settings.conf`，解析回退到 tmp）。

- [ ] **Step 8: 提交**

```bash
git add core/orchestrator/db.js core/orchestrator/index.js core/orchestrator/stepArtifacts.js services/http-server/index.js services/http-server/reveal.js cli/commands/run.js cli/commands/list.js
git commit -m "feat(work-root): route all Node work paths through core/paths + inject WORK_ROOT to child env

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shell 解析助手 + 接入 + 正则加固

**Files:**
- Create: `scripts/work_dir.sh`
- Modify: `scripts/db.sh:16-24`
- Modify: `scripts/fetch_info.sh:26`, `scripts/download_subs.sh:43`, `scripts/download_video.sh:23`, `scripts/generate_article.sh:12`, `scripts/generate_summary.sh:13`
- Modify: `scripts/generate_article.sh:32`, `scripts/generate_summary.sh:36`（正则）

**Interfaces:**
- Produces: `scripts/work_dir.sh` 被 source 后导出 `WORK_ROOT`、`WORK_DIR="$WORK_ROOT/work"`、`DB_PATH="$WORK_DIR/database.sqlite"`，并已 `mkdir -p "$WORK_DIR"`。

- [ ] **Step 1: 创建 `scripts/work_dir.sh`**

```bash
#!/bin/bash
# scripts/work_dir.sh — resolve the configurable work root/dir. SOURCE ONLY.
#
# Resolution (must mirror core/paths.js):
#   1. env WORK_ROOT (non-empty)
#   2. else WORK_ROOT from scripts/settings.conf
#   3. else project dir (parent of scripts/)
# Exports: WORK_ROOT, WORK_DIR (=<root>/work), DB_PATH (=<work>/database.sqlite).
# Ensures WORK_DIR exists.

_wd_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_wd_project_dir="$(dirname "$_wd_script_dir")"

# 1+2: only consult settings.conf when env did not provide WORK_ROOT.
if [ -z "${WORK_ROOT:-}" ] && [ -f "$_wd_script_dir/settings.conf" ]; then
    # shellcheck source=/dev/null
    source "$_wd_script_dir/settings.conf"
fi

# 3: default to project dir.
if [ -z "${WORK_ROOT:-}" ]; then
    WORK_ROOT="$_wd_project_dir"
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

- [ ] **Step 2: `scripts/db.sh` 默认 DB_PATH 走 work_dir.sh**

将 `scripts/db.sh` 的：

```bash
if _is_sourced; then
    # 被 sourced，使用默认值
    DB_PATH="work/database.sqlite"
elif _is_command "${1:-}"; then
    # 第一个参数是命令，使用默认值
    DB_PATH="work/database.sqlite"
else
    DB_PATH="${1:-work/database.sqlite}"
fi
```

替换为：

```bash
_db_sh_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if _is_sourced; then
    # 被 sourced：用 work_dir.sh 解析默认 DB_PATH
    source "$_db_sh_dir/work_dir.sh"
elif _is_command "${1:-}"; then
    source "$_db_sh_dir/work_dir.sh"
else
    DB_PATH="${1:-}"
    if [ -z "$DB_PATH" ]; then
        source "$_db_sh_dir/work_dir.sh"
    fi
fi
```

（保留其后既有的「若 `DB_PATH` 为相对路径则补 `PROJECT_DIR`」块，用于 `db.sh init <relative-path>` 的显式参数场景；`work_dir.sh` 已给出绝对路径，该块对其为 no-op。）

- [ ] **Step 3: 删除 5 个脚本中已失效的 DB_PATH 行**

以下脚本均在设置 `DB_PATH` 后立即 `source db.sh`，而 `db.sh`（sourced 模式）现会用 `work_dir.sh` 覆盖 `DB_PATH`，故原行已失效，删除以消除硬编码 `work/`：

- `scripts/fetch_info.sh` 删除：`DB_PATH="$PROJECT_DIR/work/database.sqlite"`
- `scripts/download_subs.sh` 删除：`DB_PATH="$PROJECT_DIR/work/database.sqlite"`
- `scripts/download_video.sh` 删除：`DB_PATH="$PROJECT_DIR/work/database.sqlite"`
- `scripts/generate_article.sh` 删除：`DB_PATH="$PROJECT_DIR/work/database.sqlite"`
- `scripts/generate_summary.sh` 删除：`DB_PATH="$PROJECT_DIR/work/database.sqlite"`

（保留各脚本里 `PROJECT_DIR=...` 行——它用于定位 `SCRIPT_DIR`/模板等其它用途。）

- [ ] **Step 4: 任务 ID 正则加固**

`scripts/generate_article.sh` 将：

```bash
TASK_ID=$(echo "$ORIGINAL_PATH" | sed -E 's|.*/work/([^/]+)/transcript.*|\1|')
```

替换为（匹配 `/transcript/` 前一段目录名，与 work 目录命名/位置无关）：

```bash
TASK_ID=$(echo "$ORIGINAL_PATH" | sed -E 's|.*/([^/]+)/transcript/.*|\1|')
```

`scripts/generate_summary.sh` 将：

```bash
TASK_ID=$(echo "$ARTICLE_PATH" | sed -E 's|.*/work/([^/]+)/writing.*|\1|')
```

替换为：

```bash
TASK_ID=$(echo "$ARTICLE_PATH" | sed -E 's|.*/([^/]+)/writing/.*|\1|')
```

- [ ] **Step 5: 冒烟验证 work_dir.sh + db.sh（默认路径不变）**

Run:
```bash
cd /Users/harveyzhang96/Projects/Video-Learner/.worktrees/configurable-work-root
WORK_ROOT= bash -c 'source scripts/work_dir.sh; echo "$WORK_DIR"; echo "$DB_PATH"'
```
Expected: 打印 `<worktree>/work` 与 `<worktree>/work/database.sqlite`（默认回退到项目目录）。

Run（验证 env 覆盖 + ~ 展开）:
```bash
WORK_ROOT="$HOME/vl-smoke-test" bash -c 'source scripts/work_dir.sh; echo "$WORK_DIR"'
rmdir "$HOME/vl-smoke-test/work" "$HOME/vl-smoke-test" 2>/dev/null || true
```
Expected: 打印 `$HOME/vl-smoke-test/work`。

- [ ] **Step 6: 运行 CLI 套件回归**

Run: `npm run test:cli`
Expected: PASS（DB 路径解析未配置时不变）。

- [ ] **Step 7: 提交**

```bash
git add scripts/work_dir.sh scripts/db.sh scripts/fetch_info.sh scripts/download_subs.sh scripts/download_video.sh scripts/generate_article.sh scripts/generate_summary.sh
git commit -m "feat(scripts): resolve DB_PATH via work_dir.sh + harden task-id regex

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Node ↔ Shell 解析对拍测试

**Files:**
- Test: `tests/work-dir-parity.test.js` (create)

**Interfaces:**
- Consumes: `core/paths.js` `resolveWorkBase`/`getWorkRoot`/`getDbPath`；`scripts/work_dir.sh`。

- [ ] **Step 1: 写对拍测试**

创建 `tests/work-dir-parity.test.js`：

```js
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
```

- [ ] **Step 2: 运行对拍测试**

Run: `node tests/work-dir-parity.test.js`
Expected: `work-dir-parity.test.js: PASS`

> 若失败显示 `WORK_DIR mismatch`，说明两端解析逻辑漂移——优先核对 `expandPath`（Node）与 `work_dir.sh` 的 `~`/尾斜杠处理是否一致。

- [ ] **Step 3: 提交**

```bash
git add tests/work-dir-parity.test.js
git commit -m "test(work-root): parity between core/paths.js and work_dir.sh

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 配置项与文档

**Files:**
- Modify: `scripts/settings.conf`、`scripts/settings.example.conf`
- Create: `docs/how-to/configure-work-dir.md`

**Interfaces:** 无代码接口；仅配置样例与文档。

- [ ] **Step 1: 在 `settings.example.conf` 增加 WORK_ROOT 注释样例**

在 `scripts/settings.example.conf` 适当位置（如下载设置附近）追加：

```bash

# work 根目录（任务产物与 SQLite 数据库的存放位置的父目录）
# 留空 = 默认存放在项目目录下的 work/。
# 设为绝对路径（支持 ~ 展开）可将 work/ 移到项目外，例如 Syncthing 共享目录。
# 实际目录为 <WORK_ROOT>/work，例如下例会用 ~/Syncthing/video-learner/work
# WORK_ROOT=~/Syncthing/video-learner
```

- [ ] **Step 2: 在本地 `settings.conf` 同步该注释样例**

在 `scripts/settings.conf`（本地、gitignored）追加同样的注释块（保持 `WORK_ROOT` 注释掉，默认行为不变）。

- [ ] **Step 3: 创建迁移与警告文档**

创建 `docs/how-to/configure-work-dir.md`：

```markdown
# 配置 work 目录路径（Syncthing 同步）

默认情况下，所有任务产物与 SQLite 数据库存放在项目目录下的 `work/`。
通过 `WORK_ROOT` 配置项，可把它移到项目外的任意目录——例如 Syncthing
管理的共享目录，实现多设备间任务产物的自动同步。

## 配置方式

`WORK_ROOT` 指向一个**根目录**，真正的产物存放在它下面的 `work/` 子目录：

    WORK_ROOT = ~/Syncthing/video-learner
            ↓
    实际工作目录 = ~/Syncthing/video-learner/work/

解析优先级（Node 与 shell 一致）：

1. 环境变量 `WORK_ROOT`（单次会话覆盖）
2. `scripts/settings.conf` 中的 `WORK_ROOT`（持久配置）
3. 未设置时：项目目录（即默认 `<项目>/work`）

`WORK_ROOT` 必须是**绝对路径**，支持前导 `~` 与 `$VAR` 展开。

### 持久配置（推荐）

编辑 `scripts/settings.conf`：

    WORK_ROOT=~/Syncthing/video-learner

### 单次覆盖

    WORK_ROOT=/mnt/external vdl <URL>

## 迁移已有数据

改路径不会自动搬运既有产物。手动迁移：

    # 1. 设置 WORK_ROOT（见上）
    # 2. 把现有 work/ 内容移到新位置（注意保留 work 子目录这一层）
    mkdir -p ~/Syncthing/video-learner
    mv /path/to/project/work ~/Syncthing/video-learner/work
    # 3. 让 Syncthing 同步 ~/Syncthing/video-learner

或不迁移、从空目录全新开始亦可。

## ⚠️ Syncthing + SQLite 重要警告

`<WORK_ROOT>/work/database.sqlite` 是单一权威状态库，并使用 WAL 模式
（额外的 `-wal`/`-shm` 文件）。

**不要在两台设备上同时运行后端。** 若多设备同时写入并由 Syncthing
并发同步数据库及其 WAL 文件，可能导致数据库损坏或同步冲突。

安全用法：**单设备轮流使用**——一台设备使用时，确保另一台未运行后端
（CLI / `vdl web` / `npm run agent:serve` / Electron 均会启动后端）。
切换设备前，等待 Syncthing 完成同步。
```

- [ ] **Step 4: 全量回归（确保文档/配置改动未影响行为）**

Run: `npm run test:agent:core && npm run test:orchestrator:unit && npm run test:reset-scope && npm run test:cli && node tests/work-dir-resolution.test.js && node tests/work-dir-parity.test.js`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add scripts/settings.conf scripts/settings.example.conf docs/how-to/configure-work-dir.md
git commit -m "docs(work-root): document WORK_ROOT config, migration, Syncthing/SQLite warning

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage（逐条对照 spec §1–§6）：**
- §1 配置与解析契约 → Task 1（Node）+ Task 3（Shell）+ Global Constraints。✓
- §2 Node 单一解析器 + 各消费方 + mkdir + spawnEnv 注入 → Task 1 + Task 2。✓（mkdir 由 `db.js` 既有逻辑覆盖，已在 Task 2 Step 1 注明。）
- §3 Shell 单一 sourced 助手 + db.sh + 5 脚本 → Task 3。✓
- §4 任务 ID 正则加固 → Task 3 Step 4。✓
- §5 迁移与文档 + Syncthing/SQLite 警告 → Task 5。✓
- §6 测试（解析单测 + 对拍 + 回归）→ Task 1（单测）、Task 4（对拍）、各 Task 的回归 Step。✓

**2. Placeholder scan：** 无 TBD/TODO；每个改代码的 step 均含完整代码或精确 sed 替换。✓

**3. Type/名称一致性：** `core/paths.js` 导出 `resolveWorkBase`/`getWorkRoot`/`getDbPath`/`getIndexPath`/`getTaskDirs`，在 Task 2 各消费方与 Task 4 中引用名称一致。`spawnEnv(rootDir)` 新签名在两处调用同步更新。`work_dir.sh` 导出 `WORK_ROOT`/`WORK_DIR`/`DB_PATH` 与对拍测试读取一致。✓

> **已知风险提示（执行者注意）：** `index.js` 的 require 路径是 `require('../paths')`（`index.js` 在 `core/orchestrator/`，`paths.js` 在 `core/`），勿写成 `./paths`。计划正文 Task 2 Step 2 已含此提醒。
