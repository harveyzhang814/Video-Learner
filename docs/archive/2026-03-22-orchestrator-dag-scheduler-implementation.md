# Orchestrator B 层 DAG + 单队列串行 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 `core/orchestrator` 中实现与设计文档一致的 **B 层就绪判定** 与 **两档序列优先级出队**，重构 `runTask` 为「循环：算就绪集 → 选步 → `runStep`」，使 **`article` 先于 `md2vtt`**、**`subs` 先于 `video`**，且 **`video` failed 不阻塞**主链；`runStep` 仍承担 **A 层** 必需物检查（不变）。

**Architecture:** 新增纯函数模块（DAG 边、就绪集、`pickNextStep`），`runTask` 仅负责循环调度与任务级 `status`/finalize；不引入多 worker 并行。第二阶段再实现「从指定 step 重置后继 + 继续调度」API。

**Tech Stack:** Node.js（CommonJS）、现有 `SQLite`/`ensureTask`/事件发射；测试沿用仓库 `tests/` 风格（如 `node --test` 或项目已有 runner）。

**设计依据：** [2026-03-22-orchestrator-dag-scheduler.md](./2026-03-22-orchestrator-dag-scheduler.md)

---

### Task 1: 新增 `core/orchestrator/schedule.js`（DAG + 就绪 + 出队）

**Files:**
- Create: `core/orchestrator/schedule.js`
- Modify: `core/orchestrator/index.js`（后续 Task 引用本模块）

**内容约定（须与 design 一致）：**

1. **DAG 边（前置 → 后继）**  
   `fetch → video|audio|subs`；`subs → vtt2md`；`vtt2md → md2vtt`；`vtt2md → article`；`article → summary`。

2. **前驱满足条件**  
   对每条入边，前驱状态须为 `completed` 或 `skipped`。**`failed` 不算满足**，后继不得进入就绪集。

3. **就绪集 `computeReadySteps(task)`**  
   - 候选步：`status === 'pending'`（首版 **不要** 把 `failed` 自动当作可调度，避免死循环；手动重试由现有 `runStep`/`retry` 路径先把状态改回 `pending`）。  
   - 跳过 `mode` 下永不跑的步（与 `runStep` 一致：`video`/`audio` 互斥跳过已在 `runStep` 内写 DB；调度层对 `both` **不调度 `audio`**，与现 `runTask` 一致）。  
   - `transcript`：`video`/`audio` 视为跳过，不进入候选。

4. **`pickNextStep(readySet, mode)`**  
   - 主链列表：`fetch`, `subs`, `vtt2md`, `article`, `summary`。  
   - 次链列表：`video`, `audio`, `md2vtt`（按 `mode` 过滤：`both` 只保留 `video` 不保留 `audio`）。  
   - 规则：若 `ready ∩ 主链` 非空，返回主链中**最靠前**的一步；否则若 `ready ∩ 次链` 非空，返回次链中最靠前的一步；否则返回 `null`。

5. **导出**  
   `computeReadySteps`, `pickNextStep`（及单元测试需要的常量如 `STEP_EDGES` 若便于断言可导出）。

**Step 1:** 编写 `tests/orchestrator-schedule.test.js`（或并入现有 test 文件）：构造内存 `task` 对象（`params.mode`, `steps`），断言  
   - `fetch` completed 后 ready 含 `subs` 与 `video`（`mode: both`），`pickNext` 为 `subs`；  
   - `vtt2md` completed 后 ready 同时含 `article` 与 `md2vtt` 时 `pickNext` 为 `article`；  
   - `subs` failed 时 `vtt2md` 不在 ready；  
   - `video` failed 时 `subs` 仍可 ready（在 fetch completed 前提下）。

**Step 2:** 运行测试，预期 **FAIL**（模块尚未实现）。

**Step 3:** 实现 `schedule.js` 直至测试 **PASS**。

**Step 4:** Commit

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat(orchestrator): add B-layer schedule helpers (ready set + priority pick)"
```

---

### Task 2: 重构 `runTask` 使用调度循环

**Files:**
- Modify: `core/orchestrator/index.js`（`runTask` 主体）
- Reference: `electron/src/orchestrator.js`（Task 3）

**行为：**

1. 在 `try` 内将固定 `await` 链替换为循环：每轮 `computeReadySteps(task)` → `pickNextStep(ready, mode)` → 若无则 `break` → 否则 `await runStep(taskId, next, options)`（`summary` 时传入 `focus`，`video`/`audio` 传 `force`）。
2. **`summary` 的 `focus`：** 与现 `runTask` 一致（`options.focus` / `task.meta.focus`）。
3. **任务结束条件：** 无就绪步时退出循环；随后保留现有 `updateTaskMetaFromFilesystem`、失败步扫描、`task.status` 判定、`finally` 内 reconcile 与 `opencode_server` 逻辑。
4. **失败不阻塞无依赖就绪步：** 某步 `failed` 后仍继续循环，使例如 `video` fail 后仍可调度 `subs`（与设计一致）。
5. **防回归：** 全 pipeline 跑通后 **`article` 在 `md2vtt` 之前**执行。

**Step 1:** 改 `runTask`，本地跑现有与 orchestrator 相关测试（以 `package.json` scripts 为准）。

**Step 2:** 修复因顺序变化导致的单测断言（若有）。

**Step 3:** Commit

```bash
git add core/orchestrator/index.js
git commit -m "feat(orchestrator): drive runTask via DAG ready set and priority queue"
```

---

### Task 3: 对齐 Electron 本地 `run()` 顺序（若仍独立链）

**Files:**
- Modify: `electron/src/orchestrator.js`（`run()` 内 `checkStep` 顺序）

**说明：** 若 Electron 仍使用本地 `checkStep` 链而非仅 HTTP → `runTask`，须将顺序改为与 **`pickNext` 等价结果**一致，或改为 **只调用 `core.runTask`**（推荐二选一，避免双维护）。

**Step 1:** 跑 Electron 相关测试或最小手动验证步骤顺序。

**Step 2:** Commit

```bash
git add electron/src/orchestrator.js
git commit -m "fix(electron): align pipeline order with orchestrator schedule"
```

---

### Task 4: 文档与交叉引用

**Files:**
- Modify: `docs/PROJECT_KNOWLEDGE.md`（若有「runTask 线性链」表述，改为「`runTask` 内调度循环 + `schedule.js`」一句）

**Step 1:** 更新 `PROJECT_KNOWLEDGE.md`（若适用）。

**Step 2:** Commit

```bash
git add docs/PROJECT_KNOWLEDGE.md
git commit -m "docs: describe runTask schedule loop in PROJECT_KNOWLEDGE"
```

---

### Task 5（可选 / 第二阶段）：`resumeFromStep` 重置后继 + 调度

**Files:**
- Modify: `core/orchestrator/schedule.js`（`getDownstreamClosure(stepName)` 基于边 BFS/DFS）
- Modify: `core/orchestrator/index.js`（新导出 `resumeTaskFromStep(taskId, stepName, options)`）
- Modify: `services/http-server/index.js`（若暴露 REST）

**语义：** 将 `S` 与从 `S` 出发沿 DAG **有向可达**的所有步（不含被 `mode` skipped 的节点）置 `pending` 并写回 DB；然后调用与 `runTask` 相同的调度循环。

---

## 验收清单

- [ ] `schedule.js` 单测覆盖：主链优先、次链、`failed` 前驱不释放后继、`video` fail 不挡 `subs`。
- [ ] `runTask` 集成测试或 e2e：`article` 早于 `md2vtt`。
- [ ] `both` 模式仍不自动跑 `audio`（与现行为一致），或产品决定变更则同步改 design。
- [ ] HTTP `createTask` + `runTask` 路径仍 fire-and-forget 可用。
