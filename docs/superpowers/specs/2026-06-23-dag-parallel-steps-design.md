---
title: 按 DAG 拓扑支持无依赖步骤并发执行
date: 2026-06-23
status: approved
topic: dag-parallel-steps
---

# 按 DAG 拓扑支持无依赖步骤并发执行

## 背景与目标

当前 `runTask`（`core/orchestrator/index.js:1105`）按拓扑顺序**串行**执行步骤：
每轮 `computeReadySteps` 算出就绪节点集合，`pickNextStep` 用主链/旁支优先级
**收敛到唯一一个** step，`await runStep` 跑完后再进入下一轮。

`computeReadySteps`（`schedule.js:320`）本身已经返回所有就绪节点的 **Set**——
DAG 就绪判定逻辑已完备。瓶颈仅在于执行层每轮只消费一个。

**目标**：把串行循环改为带并发上限的池式调度器，让无前置依赖或依赖已满足的
节点并发执行，缩短多步骤任务整体耗时。

### 真实并行收益

DAG 边（`schedule.js:67`）：

```
fetch → video, audio, subs, asr
subs  → vtt2md
asr   → vtt2md
vtt2md → translate, article
translate → md2vtt
article → summary
```

现状下 `video`/`audio` 下载（最长可达 2h 超时）会被主链优先级压到
`subs→vtt2md→article→summary` 整条链跑完之后才执行。两组核心并行机会：

- **media 下载 ‖ 转录流水线**
- **`translate→md2vtt` ‖ `article→summary`**

## 设计决策（已与用户确认）

| 维度 | 决策 | 理由 |
|------|------|------|
| 并发模型 | 固定并发上限 N | 兼顾提速与资源保护，避免 CPU/网络/LLM API 同时被打满 |
| 默认 N | 3（`VL_MAX_PARALLEL_STEPS` 环境变量可覆盖） | 主链优先 + 现实 DAG 下真正有用的独立步骤约 2–3 个 |
| 优先级 | 保留主链优先，余量并发 | 确保 summary 仍最快产出，回归风险低 |
| 上限作用域 | 每任务 N | 与现有 per-task 状态自然契合；实现简单 |
| 失败语义 | 让在飞步骤跑完，仅不调度新依赖 | 与现有"video 失败不阻塞转录"容错一致 |

## Section 1 — 调度循环改造

`runTask`（`index.js:1105`）的串行 for-循环替换为池式调度：

```
N = max(1, VL_MAX_PARALLEL_STEPS || 3)
inFlight = Map<stepName, Promise<{stepName, result}>>

loop:
  # 填槽：主链优先，余量给旁支
  while (inFlight.size < N && !task._abortFlag) {
    ready = computeReadySteps(task)          # 已是 Set，且天然排除 running
    next  = pickNextStep(ready, mode, steps) # 复用现有主链/旁支优先级
    if (!next) break
    p = runStep(taskId, next, buildStepOptions(next))  # 不 await，立即占槽
         .then(result => ({ stepName: next, result }))
         .catch(err => ({ stepName: next, error: err }))
    inFlight.set(next, p)
  }
  if (inFlight.size === 0) break             # 无在飞 + 无就绪 → 完成
  if (task._abortFlag) break
  settled = await Promise.race(inFlight.values())  # 等至少一个 step 落定
  inFlight.delete(settled.stepName)                # 腾槽，回到 loop 重新填
```

退出循环后仍走原有 finalize 路径（`isTaskFailed` / `isTaskCompleted` 标定
整体状态、文件系统对账）。

**关键正确性依据**：`runStep` 在第一个 `await`（`runStepScript`）之前就**同步**
把 `status` 置为 `running`（`index.js:575`，前面只有同步的 skip 判断与
`validateStepArtifacts`）。因此 `runStep(...)` 一旦被调用、占槽，下一轮
`computeReadySteps` 凭 `step.status !== 'pending'` 自然排除它——无需额外的
"in-flight 去重集合"。主链优先级靠 `pickNextStep` 的既有顺序保留：每轮填槽
都先选到主链节点，旁支只在主链无 ready 时拿剩余槽位。

> **实现注意**：现有循环里对 `next === 'summary'` / `'video'` / `'audio'` 的
> `stepOptions` 构造（focus 注入、force 透传、timeout_scale 透传）需抽成
> `buildStepOptions(next)` 以便填槽处复用。

并发上限通过模块级常量读取 env：

```js
function getMaxParallelSteps() {
  const n = Number(process.env.VL_MAX_PARALLEL_STEPS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3;
}
```

## Section 2 — abort 重构：单槽 → per-step map

当前 `task._currentProc` / `task._stepAbortResolve` 是**单槽**，隐含"同一时刻
只有一个 step 在跑"。并发后必须按 `stepName` 分键。

**状态字段**（`index.js:241-244`、`313-316` 两处初始化）：

```
task._currentProc      → task._currentProcs      = {}   // stepName -> proc
task._stepAbortResolve → task._stepAbortResolves = {}   // stepName -> resolve
```

**`runStep` 内部**（约 5 处 onProc / 清理 / 检查，`stepName` 已是入参）：

```js
onProc: (proc) => { task._currentProcs[stepName] = proc; }
// 步骤落定后
delete task._currentProcs[stepName];
const resolve = task._stepAbortResolves[stepName];
if (resolve) { delete task._stepAbortResolves[stepName]; resolve(); }
```

**`abortStep(taskId, stepName)`**（`index.js:1426`）：单槽改为
`task._currentProcs[stepName]`，只 kill 目标 step 的进程，设
`task._stepAbortResolves[stepName]`。其它在飞 step 不受影响——契合"让在飞的
跑完"语义。

**`abortTask(taskId)`**（`index.js:1392`）：`_abortFlag=true` 后，从只 kill 一个
`_currentProc` 改为**遍历** `task._currentProcs` 全部 kill。`runTask` 的 `finally`
块（`index.js:1144-1170`）里清理在飞 running step 的逻辑改为遍历 map（对每个
仍为 `running` 的 step 重置为 pending、删除其产物）。

**失败语义落地**：单个 step reject/失败时，调度循环只把它从 `inFlight` 删除、
不再调度其下游（`computeReadySteps` 因前置未 completed 自然不产出下游）；
不影响其它在飞 step。

## Section 3 — 并发安全性核对（无需改动，仅确认）

- **DB**：`better-sqlite3` 同步原子，并发 `runStep` 只在 `await` 点交错，
  `db.updateStep` 各自原子写不同 step 行 → 安全。
- **文件输出**：各 step 写不同产物（`original_zh.md` / `article.md` /
  `video.mp4`…），无写冲突。
- **SSE/事件**：`step.started` / `step.finished` 已带 `stepName`，前端天然区分
  并发 step → 无需改。
- **opencode server stop**：`finally` 里 `activeRunTasks === 0` 才 stop，
  per-task 池不影响该判断。

## Section 4 — 测试

- `tests/orchestrator-unit`：新增并发调度用例——给定全 ready 的 DAG，断言一轮
  内最多 N 个 step 进入 running；断言主链节点优先占槽；断言 N=1 时退化为现有
  串行行为（回归保护）。
- `tests/abort`：断言 `abortStep` 只杀目标 step、其它在飞 step 继续；
  `abortTask` 杀全部在飞 step。
- 回归：复用现有 `reset-scope` / `sse` 套件。

## 影响面

| 文件 | 改动 |
|------|------|
| `core/orchestrator/index.js` | `runTask` 调度循环、`_currentProcs`/`_stepAbortResolves` 字段、`runStep` 内 5 处 proc 键、`abortStep`/`abortTask`/`finally` 遍历、`buildStepOptions` 抽取、`getMaxParallelSteps` |
| `core/orchestrator/schedule.js` | 无需改动（`computeReadySteps`/`pickNextStep` 复用） |
| `tests/` | 并发调度 + abort 用例 |
| `docs/` | 本 spec + 后续实现计划 |

## 非目标（YAGNI）

- 不做资源感知分类并发（按类型分组限流）——用户已选固定上限。
- 不做全局跨任务并发闸门——上限作用域为每任务。
- 不做"快速失败取消所有在飞 step"——失败语义为让在飞跑完。
