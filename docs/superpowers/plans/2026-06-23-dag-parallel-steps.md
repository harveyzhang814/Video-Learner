# DAG 步骤并发执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `runTask` 的串行步骤循环改为带固定并发上限的池式调度器，让 DAG 中无依赖/依赖已满足的步骤并发执行。

**Architecture:** `computeReadySteps` 已返回所有就绪节点的 Set；新增纯函数 `pickReadyStepsOrdered` 按主链优先级把就绪集排成有序数组。`runTask` 用一个最多 N 个在飞步骤的池消费这个数组：填槽时主链优先，`Promise.race` 等任一步骤落定后腾槽再填。并发要求把单槽的 `task._currentProc` / `task._stepAbortResolve` 改为按 stepName 分键的 map，abort 逻辑随之改为按键操作 / 遍历。

**Tech Stack:** Node.js（无测试框架，`node tests/*.test.js` 直接跑，`assert` + `process.exit`）、better-sqlite3、child_process。

## Global Constraints

- 开发只能在 `feature/*` 分支上进行（当前分支 `feature/dag-parallel-steps`）。禁止在 `master`/`staging` 直接开发。
- 默认并发上限 N=3，通过环境变量 `VL_MAX_PARALLEL_STEPS` 覆盖（≥1 的整数，非法值回落 3）。
- 上限作用域为**每任务**（每个 `runTask` 内最多 N 个步骤并发）。
- 失败语义：单步失败/中止只影响其下游调度，不中断其它在飞步骤。
- 主链优先级（`PRIMARY_CHAIN` 先于 `SECONDARY_CHAIN`）必须保留。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

| 文件 | 职责 | 改动 |
|------|------|------|
| `core/orchestrator/schedule.js` | DAG 就绪判定与优先级排序（纯函数） | 新增并导出 `pickReadyStepsOrdered` |
| `core/orchestrator/index.js` | 任务状态机 + 执行循环 | 新增 `getMaxParallelSteps`；状态字段单槽→map；`runStep` 内 proc/abort 引用改键；`runTask` 池式循环 + `buildStepOptions`；`abortStep`/`abortTask`/`finally` 改键/遍历 |
| `tests/orchestrator-schedule.test.js` | 调度纯函数单测 | 新增 `pickReadyStepsOrdered` 用例 |
| `tests/task-parallel.test.js` | 并发行为集成测试（新建） | 并发计数 + N=1 回归 |
| `tests/task-abort.test.js` | 中止行为集成测试 | 新增并发场景：`abortStep` 仅杀目标、`abortTask` 杀全部 |

---

## Task 1: `pickReadyStepsOrdered` 纯函数 + 单测

把就绪 Set 排成主链优先的有序数组，供池式循环填槽。纯函数，独立可测。

**Files:**
- Modify: `core/orchestrator/schedule.js`（在 `pickNextStep` 之后、`module.exports` 之前新增函数；并加入导出）
- Test: `tests/orchestrator-schedule.test.js`（在 `getDownstreamClosure` 用例块之后追加）

**Interfaces:**
- Consumes: 现有 `pickNextStep(readySet, mode, steps)`。
- Produces: `pickReadyStepsOrdered(readySet, mode, steps) -> string[]`（按主链→旁支优先级排列的就绪步骤名数组；输入为空或无可选步骤时返回 `[]`）。

- [ ] **Step 1: 写失败的单测**

在 `tests/orchestrator-schedule.test.js` 顶部 require 解构里加入 `pickReadyStepsOrdered`：

```js
const { computeReadySteps, pickNextStep, pickReadyStepsOrdered, getDownstreamClosure, normalizeMode, excludedByMode, isNodeReachable, isTaskFailed, isTaskCompleted } = require('../core/orchestrator/schedule');
```

在 `getDownstreamClosure` 的 `{ ... }` 用例块之后、`console.log('orchestrator-schedule.test.js: PASS')` 之前插入：

```js
    // pickReadyStepsOrdered: media mode after fetch — subs (main chain) before video (secondary)
    {
      const steps = baseSteps();
      steps.fetch = completed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      const ordered = pickReadyStepsOrdered(ready, 'media', steps);
      assert.deepStrictEqual(ordered, ['subs', 'video'], 'subs (main) precedes video (secondary)');
    }

    // pickReadyStepsOrdered: empty ready set yields empty array
    {
      const steps = baseSteps();
      const ordered = pickReadyStepsOrdered(new Set(), 'media', steps);
      assert.deepStrictEqual(ordered, [], 'empty ready set -> []');
    }

    // pickReadyStepsOrdered: parallel side branches — translate and article both ready, main chain first
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = completed();
      steps.video = completed();
      steps.vtt2md = completed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);              // expect { translate, article, audio? } minus excluded
      const ordered = pickReadyStepsOrdered(ready, 'media', steps);
      assert.strictEqual(ordered[0], 'article', 'article (main chain) picked first');
      assert.ok(ordered.includes('translate'), 'translate (side branch) included');
      assert.ok(ordered.indexOf('article') < ordered.indexOf('translate'), 'article before translate');
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/orchestrator-schedule.test.js`
Expected: FAIL —`TypeError: pickReadyStepsOrdered is not a function`。

- [ ] **Step 3: 实现 `pickReadyStepsOrdered`**

在 `core/orchestrator/schedule.js` 中 `pickNextStep` 函数结束（`}` 于约 line 363）之后插入：

```js
/**
 * Order all ready steps by scheduling priority (main chain first, then secondary).
 * Pure: repeatedly applies pickNextStep over a shrinking working copy so the
 * existing priority rules are the single source of truth.
 *
 * @param {Set<string>|string[]} readySet
 * @param {string} [mode]
 * @param {object} [steps]
 * @returns {string[]} ready step names in priority order
 */
function pickReadyStepsOrdered(readySet, mode, steps) {
  const work =
    readySet instanceof Set ? new Set(readySet) : new Set(Array.isArray(readySet) ? readySet : []);
  const out = [];
  let next;
  while ((next = pickNextStep(work, mode, steps)) !== null) {
    out.push(next);
    work.delete(next);
  }
  return out;
}
```

在 `module.exports = { ... }` 中加入 `pickReadyStepsOrdered,`（紧挨 `pickNextStep,`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/orchestrator-schedule.test.js`
Expected: PASS（输出 `orchestrator-schedule.test.js: PASS`）。

- [ ] **Step 5: 提交**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(schedule): add pickReadyStepsOrdered priority ordering helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 单槽进程/中止状态 → per-step map

把 `task._currentProc`（单进程槽）和 `task._stepAbortResolve`（单中止 resolver）改为按 `stepName` 分键的 map，使多步骤并发时互不覆盖。纯机械重命名，行为不变；以现有 `tests/task-abort.test.js` 全绿为门槛（串行场景下 map 只有一个键，等价于原行为）。

**Files:**
- Modify: `core/orchestrator/index.js`（两处状态初始化、`runStep` 内 ~5 处 proc/abort 引用、`abortTask`、`abortStep`、`runTask` 的 `finally` 块）

**Interfaces:**
- Produces: `task._currentProcs`（`{ [stepName]: ChildProcess }`）、`task._stepAbortResolves`（`{ [stepName]: () => void }`）。后续 Task 3/4 依赖这两个字段。

- [ ] **Step 1: 改两处状态初始化（replace_all）**

两处初始化块（`loadTaskFromDb` 约 line 241-244、`createTask` 约 line 313-316）文本完全相同。用 replace_all 把：

```js
    _abortFlag: false,
    _currentProc: null,
    _abortResolvers: [],
    _stepAbortResolve: null
```
替换为：
```js
    _abortFlag: false,
    _currentProcs: {},
    _abortResolvers: [],
    _stepAbortResolves: {}
```

- [ ] **Step 2: 改 `runTask` finally 的状态重置块**

唯一出现的三行块（约 line 1166-1168）：

```js
      task._abortFlag = false;
      task._currentProc = null;
      task._stepAbortResolve = null;
```
替换为：
```js
      task._abortFlag = false;
      task._currentProcs = {};
      task._stepAbortResolves = {};
```

- [ ] **Step 3: 改 `runStep` 内的 onProc 设置（replace_all）**

`runStep` 中有 5 处 `onProc` 设置同一进程槽。replace_all：

```js
      onProc: (proc) => { task._currentProc = proc; },
```
替换为：
```js
      onProc: (proc) => { task._currentProcs[stepName] = proc; },
```

> 注意：5 处缩进相同（均为 6 空格 + `onProc`）。若某处缩进不同导致 replace_all 报"非唯一/未命中"，逐处用足够上下文单独替换。

- [ ] **Step 4: 改 `runStep` 内的进程槽清理（replace_all，仅 runStep 内 6 处）**

Step 2 已把 `finally` 的 `task._currentProc = null;` 改走，剩余 6 处全部在 `runStep` 内（约 line 725, 731, 802, 847, 853, 961）。replace_all：

```js
      task._currentProc = null;
```
替换为：
```js
      delete task._currentProcs[stepName];
```

> 缩进差异同上提醒：若个别处（如 line 961 为 4 空格）replace_all 未覆盖，单独替换 `    task._currentProc = null;` → `    delete task._currentProcs[stepName];`。

- [ ] **Step 5: 改 `runStep` 内 break 判定（replace_all）**

`vtt2md` / `md2vtt` 循环里的 2 处（约 line 726, 848）：

```js
          if (task._abortFlag || task._stepAbortResolve) break;
```
替换为：
```js
          if (task._abortFlag || task._stepAbortResolves[stepName]) break;
```

- [ ] **Step 6: 改 `runStep` 内 4 处 step-abort resolve 块**

4 处结构相同的块（约 line 736-738, 804-806, 857-859, 963-965），把三行：

```js
      if (task._stepAbortResolve) {
        const resolve = task._stepAbortResolve;
        task._stepAbortResolve = null;
```
逐处替换为：
```js
      if (task._stepAbortResolves[stepName]) {
        const resolve = task._stepAbortResolves[stepName];
        delete task._stepAbortResolves[stepName];
```

> 这 4 处缩进可能不一致（3 处 6 空格、1 处 4 空格）。优先按缩进分组 replace_all；剩余单独替换。每块后续的 `resolve();` 行无需改动。

- [ ] **Step 7: 改 `abortTask` 取进程**

`abortTask` 中（约 line 1396）：

```js
  const proc = task._currentProc;
  if (proc && proc.pid) {
    const sigkillTimer = setTimeout(() => {
      try { process.kill(-proc.pid, 'SIGKILL'); } catch (_) {}
    }, 5000);
    waitDone.then(() => clearTimeout(sigkillTimer));
    try { process.kill(-proc.pid, 'SIGTERM'); } catch (_) {}
  } else {
    // No proc running (between steps): DAG loop will see _abortFlag and break,
    // then the finally block calls resolvers. Nothing extra needed here.
  }
```
替换为（遍历所有在飞进程，全部 kill）：
```js
  const procs = Object.values(task._currentProcs).filter((p) => p && p.pid);
  if (procs.length > 0) {
    const sigkillTimer = setTimeout(() => {
      for (const p of procs) {
        try { process.kill(-p.pid, 'SIGKILL'); } catch (_) {}
      }
    }, 5000);
    waitDone.then(() => clearTimeout(sigkillTimer));
    for (const p of procs) {
      try { process.kill(-p.pid, 'SIGTERM'); } catch (_) {}
    }
  } else {
    // No proc running (between steps): DAG loop will see _abortFlag and break,
    // then the finally block calls resolvers. Nothing extra needed here.
  }
```

- [ ] **Step 8: 改 `abortStep` 守卫与取进程**

`abortStep` 中（约 line 1426-1441），把：

```js
  if (task._stepAbortResolve) {
    const e = new Error('step abort already in progress');
    e.code = 'STEP_ABORT_IN_PROGRESS';
    throw e;
  }

  const waitDone = new Promise((resolve) => { task._stepAbortResolve = resolve; });

  const proc = task._currentProc;
```
替换为（守卫与 resolver 均按 stepName 分键，进程取目标步骤的槽）：
```js
  if (task._stepAbortResolves[stepName]) {
    const e = new Error('step abort already in progress');
    e.code = 'STEP_ABORT_IN_PROGRESS';
    throw e;
  }

  const waitDone = new Promise((resolve) => { task._stepAbortResolves[stepName] = resolve; });

  const proc = task._currentProcs[stepName];
```

- [ ] **Step 9: grep 验证无残留单槽引用**

Run: `grep -nE '_currentProc\b|_stepAbortResolve\b' core/orchestrator/index.js`
Expected: 无输出（所有单数形式已改为 `_currentProcs` / `_stepAbortResolves`）。若仍有命中，逐个修正。

- [ ] **Step 10: 跑现有中止套件回归**

Run: `npm run test:abort`
Expected: PASS（全部 `[abort-test] Test N passed`）。

- [ ] **Step 11: 跑核心套件回归**

Run: `npm run test:agent:core`
Expected: PASS。

- [ ] **Step 12: 提交**

```bash
git add core/orchestrator/index.js
git commit -m "refactor(orchestrator): per-step maps for proc and abort resolvers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `runTask` 池式并发调度循环

把 `runTask` 的串行 for-循环替换为最多 N 个在飞步骤的池。先写一个能观察并发的集成测试（串行实现下并发计数恒为 1 → 失败），再实现池式循环让其通过。

**Files:**
- Modify: `core/orchestrator/index.js`（顶部新增 `getMaxParallelSteps`；`require('./schedule')` 解构加入 `pickReadyStepsOrdered`；替换 `runTask` 调度循环并抽出 `buildStepOptions`）
- Test: `tests/task-parallel.test.js`（新建）
- Modify: `package.json`（新增 `test:parallel` 脚本）

**Interfaces:**
- Consumes: `pickReadyStepsOrdered`（Task 1）、`task._currentProcs`（Task 2）、现有 `computeReadySteps` / `runStep`。
- Produces: `runTask` 并发语义；`getMaxParallelSteps() -> number`。

- [ ] **Step 1: 写失败的并发集成测试**

新建 `tests/task-parallel.test.js`：

```js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const orchestrator = require('../core/orchestrator');

const SLEEP_SCRIPT = `#!/usr/bin/env bash
sleep 1.5
exit 0
`;
const EXIT0_SCRIPT = `#!/usr/bin/env bash
exit 0
`;

// fetch is instant; subs and video both sleep so they can overlap after fetch.
const STUBS = {
  'fetch_info.sh':       EXIT0_SCRIPT,
  'download_video.sh':   SLEEP_SCRIPT,
  'download_audio.sh':   EXIT0_SCRIPT,
  'download_subs.sh':    SLEEP_SCRIPT,
  'asr_transcribe.sh':   EXIT0_SCRIPT,
  'convert_vtt_md.sh':   EXIT0_SCRIPT,
  'convert_md_vtt.sh':   EXIT0_SCRIPT,
  'generate_article.sh': EXIT0_SCRIPT,
  'generate_summary.sh': EXIT0_SCRIPT,
};

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-parallel-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
  for (const [name, content] of Object.entries(STUBS)) {
    const p = path.join(dir, 'scripts', name);
    fs.writeFileSync(p, content);
    fs.chmodSync(p, '755');
  }
  return dir;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Run a task to completion while sampling how many steps are 'running' at once.
async function measureMaxConcurrency(rootDir, urlSuffix) {
  const { task_id } = await orchestrator.createTask({
    url: `https://www.youtube.com/watch?v=${urlSuffix}`,
    mode: 'media',
    force: 1,
    rootDir,
  });
  const done = orchestrator.runTask(task_id, { rootDir }).catch(() => {});
  let maxConcurrent = 0;
  const poll = (async () => {
    for (let i = 0; i < 80; i++) {
      const t = await orchestrator.getTask(task_id, { rootDir });
      const running = Object.values(t.steps).filter((s) => s.status === 'running').length;
      if (running > maxConcurrent) maxConcurrent = running;
      if (t.status !== 'running' && t.status !== 'pending') break;
      await sleep(50);
    }
  })();
  await Promise.all([done, poll]);
  return maxConcurrent;
}

async function run() {
  // Test 1: default N (3) lets subs + video run concurrently after fetch.
  {
    const rootDir = makeTempDir();
    try {
      delete process.env.VL_MAX_PARALLEL_STEPS;
      const maxC = await measureMaxConcurrency(rootDir, 'parallel-default');
      if (maxC < 2) throw new Error(`expected >=2 concurrent steps, got ${maxC}`);
      console.log(`[parallel-test] Test 1 passed: max concurrency ${maxC} (>=2)`);
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // Test 2: N=1 degrades to serial (max concurrency 1).
  {
    const rootDir = makeTempDir();
    try {
      process.env.VL_MAX_PARALLEL_STEPS = '1';
      const maxC = await measureMaxConcurrency(rootDir, 'parallel-serial');
      if (maxC !== 1) throw new Error(`expected exactly 1 concurrent step at N=1, got ${maxC}`);
      console.log('[parallel-test] Test 2 passed: N=1 serial (max concurrency 1)');
    } finally {
      delete process.env.VL_MAX_PARALLEL_STEPS;
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  console.log('task-parallel.test.js: PASS');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/task-parallel.test.js`
Expected: FAIL — Test 1 报 `expected >=2 concurrent steps, got 1`（当前串行实现）。

- [ ] **Step 3: 新增 `getMaxParallelSteps` 并补 require**

在 `core/orchestrator/index.js` 顶部，把 schedule 解构改为加入 `pickReadyStepsOrdered`：

```js
const { computeReadySteps, pickNextStep, pickReadyStepsOrdered, getDownstreamClosure, excludedByMode, normalizeMode, isTaskFailed, isTaskCompleted, getStepTimeoutMs } = require('./schedule');
```

在该文件靠近其它顶层 helper 处（`runTask` 定义之前）新增：

```js
/**
 * Max steps allowed to run concurrently within a single runTask.
 * Override via VL_MAX_PARALLEL_STEPS (integer >= 1); invalid values fall back to 3.
 */
function getMaxParallelSteps() {
  const n = Number(process.env.VL_MAX_PARALLEL_STEPS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}
```

- [ ] **Step 4: 替换 `runTask` 的调度循环**

把 `runTask` 中 `try {` 之后的串行循环（约 line 1104-1130，从注释 `// B-layer:` 到那次 `await runStep(taskId, next, stepOptions);` 所在 for-块结束）整体替换为池式循环 + `buildStepOptions`：

```js
    // B-layer: DAG readiness + bounded-concurrency pool scheduler.
    // Main-chain steps fill slots first (pickReadyStepsOrdered preserves priority);
    // up to N steps run concurrently. A finished/failed step frees a slot.
    const N = getMaxParallelSteps();
    const inFlight = new Map(); // stepName -> Promise<{ stepName }>

    function buildStepOptions(next) {
      const stepOptions = { ...options };
      if (task.params.timeout_scale && task.params.timeout_scale !== 1) {
        stepOptions.timeoutScale = task.params.timeout_scale;
      }
      if (next === 'video' || next === 'audio') {
        stepOptions.force = task.params.force;
      }
      if (next === 'summary') {
        let summaryFocus = options.focus;
        if (summaryFocus === undefined || String(summaryFocus).trim() === '') {
          const db = ensureDb(task.params.rootDir);
          const row = db.getTask(task.meta.id);
          summaryFocus = (row && row.focus) || focus || task.meta.focus || '';
        }
        stepOptions.focus = String(summaryFocus || '').trim() || '视频的主要内容和要点';
      }
      return stepOptions;
    }

    // Safety bound on scheduler iterations (steps may reset to pending on step-abort).
    let guard = 0;
    const GUARD_MAX = 256;
    while (guard++ < GUARD_MAX) {
      if (!task._abortFlag) {
        const ready = computeReadySteps(task);                 // 'running' steps excluded
        const ordered = pickReadyStepsOrdered(ready, mode, task.steps);
        for (const next of ordered) {
          if (inFlight.size >= N) break;
          if (inFlight.has(next)) continue;                    // defensive
          const p = runStep(taskId, next, buildStepOptions(next))
            .then(() => ({ stepName: next }))
            .catch(() => ({ stepName: next }));
          inFlight.set(next, p);
        }
      }
      if (inFlight.size === 0) break;                          // nothing in flight & nothing ready
      const settled = await Promise.race(inFlight.values());
      inFlight.delete(settled.stepName);
    }
```

> 说明：`runStep` 在首个 `await` 前同步把步骤置为 `running`，故下一轮 `computeReadySteps` 自然排除已在飞步骤，无需独立去重集合。`runStep` 自身吞掉脚本失败并返回（不 reject）；`.catch` 仅作防御。中止时 `task._abortFlag` 置位后不再填槽，但仍 `await` 把在飞步骤排空，随后走原 `finally`。

- [ ] **Step 5: 跑并发测试确认通过**

Run: `node tests/task-parallel.test.js`
Expected: PASS（Test 1 max concurrency >=2，Test 2 = 1）。

- [ ] **Step 6: 加 package.json 脚本**

在 `package.json` 的 `scripts` 中，`"test:abort"` 一行之后加入：

```json
    "test:parallel": "node tests/task-parallel.test.js",
```

- [ ] **Step 7: 全量回归**

Run: `npm run test:agent:core && npm run test:abort && npm run test:parallel`
Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add core/orchestrator/index.js tests/task-parallel.test.js package.json
git commit -m "feat(orchestrator): bounded-concurrency pool scheduler in runTask

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 并发场景下的中止测试

并发后需验证两条失败/中止语义：`abortStep` 只杀目标步骤、其它在飞步骤继续；`abortTask` 杀全部在飞步骤。追加到现有中止套件。

**Files:**
- Modify: `tests/task-abort.test.js`（在 `run()` 内现有测试块之后、最终汇总输出之前追加两个测试块）

**Interfaces:**
- Consumes: Task 2/3 的并发 `runTask`、`abortStep`、`abortTask`；测试文件已有的 `makeTempDir` / `pollUntil` / `sleep` / `SLEEP_SCRIPT` / `EXIT0_SCRIPT`。

- [ ] **Step 1: 写并发中止测试块**

先确认文件顶部 `pollUntil` / `sleep` / `makeTempDir` / `SLEEP_SCRIPT` / `EXIT0_SCRIPT` 均已存在（见现有文件）。在 `run()` 中最后一个测试块之后、收尾 `console.log(...)/process.exit(0)`（若有）之前插入：

```js
  // ── Test: abortStep kills only the target step; siblings keep running ──────
  {
    // media mode: after instant fetch, subs (main) + video (secondary) run concurrently.
    const rootDir = makeTempDir({
      'fetch_info.sh':     EXIT0_SCRIPT,
      'download_subs.sh':  SLEEP_SCRIPT,   // sleeps 30
      'download_video.sh': SLEEP_SCRIPT,   // sleeps 30
    });
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=concurrent-abortstep',
        mode: 'media',
        force: 1,
        rootDir,
      });
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      // Wait until both subs and video are running concurrently.
      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return (t.steps.subs.status === 'running' && t.steps.video.status === 'running') ? t : null;
      });

      await orchestrator.abortStep(task_id, 'video', { rootDir });

      const t2 = await orchestrator.getTask(task_id, { rootDir });
      if (t2.steps.video.status !== 'pending') {
        throw new Error(`video should be pending after abortStep, got ${t2.steps.video.status}`);
      }
      if (t2.steps.subs.status !== 'running') {
        throw new Error(`subs should still be running, got ${t2.steps.subs.status}`);
      }
      console.log('[abort-test] Test passed: abortStep targets only the named step');

      await safeAbort(task_id, rootDir); // clean up the still-running subs
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }

  // ── Test: abortTask kills all in-flight steps ─────────────────────────────
  {
    const rootDir = makeTempDir({
      'fetch_info.sh':     EXIT0_SCRIPT,
      'download_subs.sh':  SLEEP_SCRIPT,
      'download_video.sh': SLEEP_SCRIPT,
    });
    try {
      const { task_id } = await orchestrator.createTask({
        url: 'https://www.youtube.com/watch?v=concurrent-aborttask',
        mode: 'media',
        force: 1,
        rootDir,
      });
      orchestrator.runTask(task_id, { rootDir }).catch(() => {});

      await pollUntil(async () => {
        const t = await orchestrator.getTask(task_id, { rootDir });
        return (t.steps.subs.status === 'running' && t.steps.video.status === 'running') ? t : null;
      });

      const result = await orchestrator.abortTask(task_id, { rootDir });
      if (result.status !== 'aborted') throw new Error(`expected aborted, got ${result.status}`);

      const t2 = await orchestrator.getTask(task_id, { rootDir });
      for (const [name, info] of Object.entries(t2.steps)) {
        if (info.status === 'running') throw new Error(`step ${name} still running after abortTask`);
      }
      console.log('[abort-test] Test passed: abortTask kills all in-flight steps');
    } finally {
      fs.rmSync(rootDir, { recursive: true });
    }
  }
```

> `makeTempDir(overrides)` 已支持按文件名覆盖 stub（见文件顶部定义），故上面直接传入 sleep 版的 subs/video。`SLEEP_SCRIPT` 睡 30s，足够测试窗口内保持 running。

- [ ] **Step 2: 跑中止套件确认通过**

Run: `npm run test:abort`
Expected: PASS，含两条新 `[abort-test] Test passed: ...` 输出。

- [ ] **Step 3: 提交**

```bash
git add tests/task-abort.test.js
git commit -m "test(abort): concurrent abortStep targeting and abortTask fan-out

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 文档与 TODO 收尾

记录新环境变量并把 TODO 条目移入已完成。

**Files:**
- Modify: `CLAUDE.md`（在「字段备忘」或「核心设计要点」处补一行并发上限说明）
- Modify: `TODO.md`（把「按 DAG 拓扑支持无依赖任务并行执行」从「🚧 待开发」移到「✅ 已完成」）

- [ ] **Step 1: CLAUDE.md 记录并发上限**

在 `CLAUDE.md` 的「### 核心设计要点」列表中，`**步骤超时**` 那一项之后新增一行：

```markdown
- **步骤并发**：单任务内按 DAG 就绪度并发执行步骤，固定上限 `N`（默认 3，`VL_MAX_PARALLEL_STEPS` 覆盖）；主链优先占槽，旁支用余量（`runTask` 池式调度）
```

- [ ] **Step 2: TODO.md 归档条目**

在 `TODO.md` 中删除「### 按 DAG 拓扑支持无依赖任务并行执行」整段（含其 `---` 分隔），并在文件末尾「## ✅ 已完成」下追加一行：

```markdown
- 按 DAG 拓扑支持无依赖任务并行执行（2026-06-23，`runTask` 池式并发，默认 N=3）
```

- [ ] **Step 3: 提交**

```bash
git add CLAUDE.md TODO.md
git commit -m "docs: document step concurrency and archive DAG-parallel TODO

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage（逐条核对 spec）：**
- Section 1 池式调度循环 → Task 3（含 `getMaxParallelSteps`、`buildStepOptions`、`pickReadyStepsOrdered` 用法）。✓
- Section 1 主链优先排序 → Task 1（`pickReadyStepsOrdered` + 优先级单测）。✓
- Section 2 `_currentProc`/`_stepAbortResolve` 单槽→map、`runStep`/`abortStep`/`abortTask`/`finally` 改造 → Task 2。✓
- Section 3 并发安全（DB/文件/SSE/opencode 无需改）→ 计划未引入改动，符合 spec「仅确认」。✓
- Section 4 测试（并发调度计数、N=1 回归、并发 abort）→ Task 3（计数 + N=1）、Task 4（并发 abort）、Task 1（优先级）。✓
- 默认 N=3 + `VL_MAX_PARALLEL_STEPS` → Task 3 `getMaxParallelSteps` + Task 5 文档。✓
- 失败语义「让在飞跑完」→ Task 3 循环不因单步失败中断（`.catch` 仅腾槽）+ Task 4 `abortStep` 用例验证。✓

**Placeholder scan：** 无 TBD/TODO/"add error handling" 等占位；每个代码步骤均给出完整代码。✓

**Type consistency：** `pickReadyStepsOrdered(readySet, mode, steps) -> string[]` 在 Task 1 定义、Task 3 调用签名一致；`task._currentProcs` / `task._stepAbortResolves` 在 Task 2 定义、Task 3/4 引用一致；`getMaxParallelSteps()` 定义与调用一致。✓
