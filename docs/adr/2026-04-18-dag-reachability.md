# ADR: DAG 可达性算法替代硬编码失败检测

**日期：** 2026-04-18  
**状态：** 已实施

## 背景

引入 ASR 回退后（见 [adr/2026-04-17-asr-fallback.md](2026-04-17-asr-fallback.md)），有两处代码手写了 `subs`/`asr` 的 OR 语义：

1. **`isContentStepFailure`**（`index.js`）：硬编码 `subs=failed AND asr=failed` 决定任务是否失败。
2. **`computeReadySteps`**（`schedule.js`）：对 `vtt2md` 单独手写 OR 前驱检查。

此外 `CONTENT_STEPS` 包含了 `md2vtt`，导致 `md2vtt=failed` 会误判整个任务为失败——但 `md2vtt` 是侧链步骤，不在通向 `summary` 的路径上。

## 决策

引入图可达性算法：**当且仅当终端节点（`summary`）从当前步骤状态出发已不可能到达 `completed`，任务才算失败。**

### 新增 DAG 常量（`schedule.js`）

```javascript
// 节点门类型。未声明节点默认 AND。
const GATE_TYPE = { vtt2md: 'OR' };

// 唯一终端节点。
const TERMINAL_NODE = 'summary';

// 任务完成所需的关键路径节点（排除侧链 md2vtt）。
const CRITICAL_PATH = ['fetch', 'vtt2md', 'article', 'summary'];
```

### `isNodeReachable` 算法

节点可达的定义：它仍有可能到达 `completed` 或 `skipped`，且能真正产生所需输出。

| 节点状态 | 可达？ |
|---------|--------|
| `completed` / `skipped` | 是 |
| `failed` | 否（终止） |
| `pending`/`running`，被 mode 排除 | **否**——永远不会产生输出 |
| `pending`/`running`，未排除 | 取决于前驱 |

OR 门的关键语义：被 mode 排除的或已 `skipped` 的前驱**不满足** OR 门——它们不会产生输出（如 VTT 文件）。这保证了 `transcript` 模式下 `subs=failed + asr=excluded` 时任务立即失败。

### `isTaskCompleted` 的严格性

不直接依赖 `summary.status`，而是检查整条关键路径。原因：`skipStep('summary')` 可被手动调用，仅靠 `summary=skipped` 无法区分「真正完成」与「手动跳过」。

## 理由

- 消除 `subs`/`asr` OR 关系的硬编码，使 DAG 扩展（新增步骤/边）时失败逻辑自动正确。
- 修复 `md2vtt=failed` 误判任务失败的静默 bug——`md2vtt` 不在 `summary` 的可达路径上，可达性算法自然忽略其失败。
- `computeReadySteps` 的调度 OR 语义与 `isNodeReachable` 的失败检测 OR 语义有意区分：调度时 `skipped` 可释放依赖；失败检测时 `skipped` 不代表「已产生输出」。

## 影响

- `core/orchestrator/schedule.js`：新增 `GATE_TYPE`、`TERMINAL_NODE`、`CRITICAL_PATH`；新增导出函数 `isNodeReachable`、`isTaskFailed`、`isTaskCompleted`；`computeReadySteps` 改为门类型驱动的通用逻辑。
- `core/orchestrator/index.js`：删除 `isContentStepFailure`、`CONTENT_STEPS`；`loadTaskFromDb` 和 `runTask` 改用 `isTaskFailed`/`isTaskCompleted`。
- `tests/orchestrator-schedule.test.js`：新增可达性场景测试（含 `md2vtt=failed` 不误判、`transcript` 模式 asr 排除即失败等）。

## 不在范围内

- 修改 `excludedByMode` 逻辑
- 新增步骤或边
- GUI 步骤级失败原因展示
