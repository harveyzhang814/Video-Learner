# ASR 回退与 DAG 调度机制

本文解释两个紧密相关的设计：ASR（本地语音识别）如何作为字幕回退集成进 pipeline，以及 DAG 调度器如何通过图可达性判断任务成败。两者共同解决"视频没有 YouTube 字幕时整条转录链被卡死"的问题。

---

## 问题背景

转录链的起点是 `subs` 步骤（下载 YouTube 字幕）。当视频没有任何字幕时，`subs` 失败，导致后续 `vtt2md → article → summary` 全部无法运行。

**早期实验**（`experiments/whisper_asr.py`）验证了可行性：用 mlx_whisper 从视频文件转录，产出与 YouTube 字幕格式相同的 VTT 文件，然后手动触发 `vtt2md` 继续。该脚本至今保留，可用于单次手动转录（参数见文件头注释）。

---

## ASR 回退：两条路径汇入一个节点

集成后，DAG 中存在两条独立路径都能让 `vtt2md` 就绪：

```
fetch ──► subs ──────────────────► vtt2md ──► translate ──► md2vtt
  │                                   ▲             │
  ├──► video ──┐                      │             └──► article ──► summary
  │            ├──► asr (fallback) ───┘
  └──► audio ──┘
```

> `translate` 位于 `vtt2md → translate → md2vtt` 侧链，负责将英文字幕翻译为中文；`article` 直接从 `vtt2md` 衍生，不经过 `translate`。

`vtt2md` 是 **OR 门**节点：`subs=completed` **或** `asr=completed` 任意一个成立即可触发。

### ASR 何时被调度？

`asr` 是动态排除步骤，仅在以下条件同时成立时进入就绪集：

1. `subs === 'failed'`（YouTube 字幕确实不可用）
2. mode ≠ `transcript`（transcript 模式下无媒体文件可供 ASR 转录）
3. 对应媒体文件已下载完成：
   - `media`/`full` 模式 → `video.mp4` 已完成
   - `audio` 模式 → `audio.m4a` 已完成

满足条件前，`asr` 被排除出调度集，不占用 slot。满足后，DAG 自动将其加入就绪集。

### ASR 产出格式

`asr_transcribe.sh` 调用 `asr_transcribe.py`（基于 mlx_whisper），将音频转录为标准 WEBVTT 格式，写入：

```
work/<id>/transcript/subs/<id>.<lang>.asr.vtt
```

其中 `<lang>` 来自 `fetch_info` 步骤从 yt-dlp 元数据中提取的视频语言码（如 `en`、`zh`），默认为 `en`。这一设计保证 `vtt2md` 能够根据文件名正确推断字幕语言，进而决定 `translate` 步骤是否触发。与 YouTube VTT 文件格式完全一致。`vtt2md` 通过 `*.vtt` glob 自动识别并处理，无需感知来源。

---

## DAG 可达性：任务何时算失败？

引入 ASR 后，"任务失败"的判断变得复杂：`subs=failed` 不代表失败，因为 `asr` 仍有可能成功。简单的步骤状态检查不再足够，需要图可达性算法。

**核心原则：当且仅当终端节点（`summary`）已不可能到达 `completed`，任务才算失败。**

### `isNodeReachable` 的语义

| 节点状态 | 可达？ | 原因 |
|---------|--------|------|
| `completed` / `skipped` | 是 | 已完成 |
| `failed` | 否 | 路径终止 |
| `pending`/`running`，被 mode 排除 | **否** | 永远不会运行，不会产生输出 |
| `pending`/`running`，未排除 | 取决于前驱 | 递归检查 |

OR 门的关键语义：**被 mode 排除的或已 `skipped` 的前驱不满足 OR 门**。例如，`transcript` 模式下 `asr` 被排除（无媒体文件），即使 `asr` 状态是 `pending`，它也不能满足 `vtt2md` 的 OR 门——这意味着 `subs=failed` 时任务立即失败，不会死等一个永远不会运行的 ASR 步骤。

### `isTaskCompleted` 的严格性

任务完成不直接看 `summary.status`，而是检查关键路径（`fetch → vtt2md → article → summary`）全部 `completed`/`skipped`，且 `subs` 或 `asr` 至少一个真正完成（非仅 `skipped`）。

原因：`skipStep('summary')` 可被手动调用作为逃生出口，但不代表 pipeline 真正跑完。

### `translate` / `md2vtt` 的特殊地位

`translate` 和 `md2vtt` 是侧链步骤（`vtt2md → translate → md2vtt`），不在通向 `summary` 的路径上。可达性算法天然忽略这两个步骤的失败——它们不影响 `summary` 是否可达，不会将任务误判为失败。（旧硬编码逻辑中，`CONTENT_STEPS` 错误地包含了 `md2vtt`，存在这个静默 bug；可达性算法修复了它。）

---

---

## DAG 并发调度：为何从串行改为池式

### 问题

旧调度循环（`runTask`）每轮调用 `computeReadySteps` 算出**全部**就绪节点，
但 `pickNextStep` 只取其中一个，`await runStep` 跑完后才进入下一轮。

DAG 中存在两组真正独立的并行机会：

```
media 下载（最长可达 2h）‖ 转录流水线（subs→vtt2md→article→summary）
translate→md2vtt          ‖ article→summary
```

串行调度下，最长的 `video`/`audio` 下载会把主链堵到最后才执行。

### 池式调度（`runTask` 当前实现）

```
N = VL_MAX_PARALLEL_STEPS（默认 3）
inFlight = Map<stepName, Promise>

loop:
  while inFlight.size < N && !abortFlag:
    next = pickNextStep(computeReadySteps(task))  # 主链优先
    if !next: break
    inFlight.set(next, runStep(...))              # 不 await，立即占槽
  settled = await Promise.race(inFlight.values()) # 等至少一个完成
  inFlight.delete(settled.stepName)               # 腾槽，回到 loop
```

**为何主链优先仍然保留**：确保 `summary` 最快产出——用户最关心的产物。
旁支（`video`/`audio` 下载）只在主链无就绪节点时占用余量槽位。

**为何不用资源感知分类**：固定上限（`VL_MAX_PARALLEL_STEPS`）实现简单、
可预测，且在现实 DAG 下真正有用的独立步骤约 2–3 个，固定 N=3 足够覆盖。

**并发安全性**：
- `better-sqlite3` 同步原子，并发 `runStep` 仅在 `await` 点交错，各自写不同步骤行，无冲突
- 各步骤写不同产物文件（`article.md` / `video.mp4` / `audio.m4a`…），无写冲突
- `runStep` 在第一个 `await` 之前**同步**将 step 置为 `running`，下一轮 `computeReadySteps` 凭状态自然排除，无需额外去重集合

---

## 相关文档

- [adr/2026-04-17-asr-fallback.md](../adr/2026-04-17-asr-fallback.md) — ASR 回退设计决策
- [adr/2026-04-18-dag-reachability.md](../adr/2026-04-18-dag-reachability.md) — 可达性算法设计决策
- `core/orchestrator/schedule.js` — `isNodeReachable`、`isTaskFailed`、`isTaskCompleted` 实现
- `core/orchestrator/index.js` — `runTask` 池式调度、`getMaxParallelSteps`
- `scripts/asr_transcribe.sh` / `scripts/asr_transcribe.py` — ASR 转录脚本
- `experiments/whisper_asr.py` — 早期独立实验脚本（手动使用）
