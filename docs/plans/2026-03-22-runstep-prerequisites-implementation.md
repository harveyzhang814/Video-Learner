# runStep A 层必需物检查 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `core/orchestrator` 的 `runStep` 中落地 [2026-03-22-runstep-prerequisites.md](./2026-03-22-runstep-prerequisites.md) 的 **A 层**检查（仅校验 URL、目录可写/可创建、`.vtt`、`original_*.md`、`article.md`），不满足时 **不 spawn**、步骤记 `failed` 并返回稳定错误文案；**不**读取上游步骤的 SQLite 状态。

**Architecture:** 新增纯函数模块 `validateStepArtifacts(task, stepName)`（或同名导出），集中各步规则；`runStep` 在 **mode 跳过** 之后、**将步骤标为 `running` 之前** 调用；失败时单次 `db.updateStep(..., 'failed', error)`（避免先 `running` 再失败导致 attempts 连加两次）。不引入 B 层调度。

**Tech Stack:** Node.js `fs` / `path`，现有 `core/orchestrator/index.js`、`core/orchestrator/db.js`。

**分支约定（CLAUDE.md）：** 在 `feature/*` 或 `hotfix/*` 上实现，勿在 `master`/`staging` 直接开发。

---

### Task 1: 可写性 / URL 辅助函数 + 单元测试

**Files:**
- Create: `core/orchestrator/stepArtifacts.js`
- Create: `tests/step-artifacts.test.js`

**Step 1: 实现辅助函数（无 `runStep` 耦合）**

在 `stepArtifacts.js` 中导出：

- `isNonEmptyString(s)`：`typeof s === 'string' && s.trim().length > 0`
- `getTaskDir(rootDir, id)`：`path.join(rootDir, 'work', id)`
- `canWriteOrCreateTaskDir(rootDir, id)`：  
  - `taskDir = getTaskDir(...)`  
  - 若 `taskDir` 已存在：`fs.accessSync(taskDir, fs.constants.W_OK)`  
  - 若不存在：`workDir = join(rootDir,'work')` — 若 `workDir` 存在则校验其 `W_OK`；若 `workDir` 也不存在，校验 `rootDir` 存在且 `W_OK`（以便后续 `mkdir work`）。失败抛错或返回 `{ ok:false, error }` 统一风格。
- `listOriginalMdFiles(transcriptDir)`：`readdirSync` + 过滤 `/^original_.+\.md$/`（与规范「任意后缀」一致，用于 **md2vtt / article** 的 A 检查）
- `hasVttInSubs(subsDir)`：目录不存在 → `false`；存在则 `readdirSync` 是否含 `*.vtt`
- `validateStepArtifacts(task, stepName)`：`task` 至少含 `params.rootDir`、`meta.id`、`meta.url`、`params.mode`；按规范矩阵返回 `{ ok: true }` 或 `{ ok: false, error: string }`（英文短句，便于 Agent）。  
  - **fetch**：`rootDir` 存在且为目录；`url` 非空；`canWriteOrCreateTaskDir`  
  - **video / audio / subs**（且未被 mode 跳过 — 由调用方保证跳过分支不进入）：`url` + `canWriteOrCreateTaskDir`  
  - **vtt2md**：`subsDir = taskDir/transcript/subs` — 须 **存在且** `hasVttInSubs` 为真（无 VTT 返回明确错误如 `No .vtt files in transcript/subs`；与规范一致：**不**为「可创建空目录」放行）  
  - **md2vtt**：`transcriptDir` 下 `listOriginalMdFiles` 长度 ≥ 1  
  - **article**：同上（与 md2vtt A 检查可复用同一判定）  
  - **summary**：`writing/article.md` `existsSync`

**Step 2: 写失败用例测试**

`tests/step-artifacts.test.js`：使用 `fs.mkdtempSync` + `chmod`（只读目录）构造不可写场景；断言 `validateStepArtifacts` 对 `video` / `vtt2md` / `summary` 等返回 `ok: false`。

**Step 3: 运行测试**

Run: `node tests/step-artifacts.test.js`（若项目用统一 runner，改为 `npm test -- tests/step-artifacts.test.js`；与仓库现有测试风格对齐）

Expected: PASS

**Step 4: Commit**

```bash
git add core/orchestrator/stepArtifacts.js tests/step-artifacts.test.js
git commit -m "feat(orchestrator): add step artifact validation helpers and tests"
```

---

### Task 2: 接入 `runStep`（`core/orchestrator/index.js`）

**Files:**
- Modify: `core/orchestrator/index.js`（`runStep` 内 mode 跳过之后、`stepState.status = 'running'` 之前）
- Optional export: `module.exports.validateStepArtifacts = ...`（仅当测试需要从外部走全链路；否则 Task 1 已覆盖）

**Step 1: 引入并调用**

```javascript
const { validateStepArtifacts } = require('./stepArtifacts');
// 在 mode skip 之后：
const pre = validateStepArtifacts(task, stepName);
if (!pre.ok) {
  const stepState = task.steps[stepName] || { status: 'pending', attempts: 0, error: null };
  stepState.status = 'failed';
  stepState.error = pre.error;
  task.steps[stepName] = stepState;
  task.updated_at = new Date().toISOString();
  db.updateStep(id, stepName, 'failed', pre.error);
  emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'failed', error: pre.error });
  emitOrchestratorEvent('task.updated', taskId, { status: task.status, stepName, stepStatus: 'failed' });
  return { success: false, error: pre.error };
}
```

**注意：** 此路径**不要**发 `step.started`（未进入 running）；与 GUI/SSE 约定若有文档需同步一句。

**Step 2: 删除或收缩后续重复检查**

- `article` / `summary` 分支内对已迁到 A 层的文件存在性检查 **删除**（避免重复逻辑）。
- **vtt2md**：若当前在「零 vtt」时仍标 `completed`，A 层会先挡；保留转换循环逻辑即可。

**Step 3: 手工/集成验证**

Run: 启动 `npm run agent:serve`（或现有 e2e），对**新任务**在**无 `subs` VTT** 时单调 `POST .../runStep` `vtt2md`，期望 `failed` + 错误信息，且**无**对应脚本长日志。

**Step 4: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): enforce A-layer step artifacts before runStep spawn"
```

---

### Task 3: 文档与行为对账

**Files:**
- Modify: `docs/plans/2026-03-22-runstep-prerequisites.md`（在「维护」节增加一行：**已实现**：指向本 implementation plan 或 PR）
- Modify: `docs/PROJECT_KNOWLEDGE.md`（可选，一小段：`runStep` 入口 A 层检查，不替代 B 层）

**Step 1: Commit**

```bash
git add docs/plans/2026-03-22-runstep-prerequisites.md docs/PROJECT_KNOWLEDGE.md
git commit -m "docs: note runStep A-layer prerequisites implementation"
```

---

### Task 4（可选 / YAGNI 之后）：`md2vtt` 支持任意 `original_*.md`

**Files:**
- Modify: `core/orchestrator/index.js` — `md2vtt` 分支：对 `listOriginalMdFiles` 结果逐项调用 `convert_md_vtt.sh`

**前提：** 产品确认 article 仍优先 en/zh 时，md2vtt 应对**所有** `original_*.md` 生成对应 `.vtt`。可与 Task 2 拆 PR。

---

## 风险与回滚

- **只读 work 目录**：A 层会提前 `failed`，行为符合规范；若测试环境权限异常需调整 chmod。
- **`db.updateStep` 每次递增 `attempts`**：A 失败仅一次 `updateStep('failed')`，比「先 running 再 failed」少一次递增，属合理修正。

---

## Plan complete

已保存至 `docs/plans/2026-03-22-runstep-prerequisites-implementation.md`。

**执行方式任选：**

1. **本会话逐步做** — 按任务顺序改代码、跑测、提交（可配合 superpowers:executing-plans / subagent-driven-development）。  
2. **新会话** — 打开 worktree，用 executing-plans 按任务批量执行并设检查点。

你要用哪一种？

---

**说明：** Cursor 的 `/write-plan` 命令已标记弃用，后续可直接说「按 `writing-plans` 写实现计划」或指向本文件。
