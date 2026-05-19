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
fetch ──► subs ──────────────────► vtt2md ──► article ──► summary
  │                                   ▲
  ├──► video ──┐                      │
  │            ├──► asr (fallback) ───┘
  └──► audio ──┘
```

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
work/<id>/transcript/subs/<id>.zh.asr.vtt
```

与 YouTube VTT 文件格式完全一致。`vtt2md` 通过 `*.vtt` glob 自动识别并处理，无需感知来源。

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

### `md2vtt` 的特殊地位

`md2vtt` 是侧链步骤（`vtt2md → md2vtt`），不在通向 `summary` 的路径上。可达性算法天然忽略 `md2vtt=failed`——它不影响 `summary` 是否可达，不会将任务误判为失败。（旧硬编码逻辑中，`CONTENT_STEPS` 错误地包含了 `md2vtt`，存在这个静默 bug；可达性算法修复了它。）

---

## 相关文档

- [adr/2026-04-17-asr-fallback.md](../adr/2026-04-17-asr-fallback.md) — ASR 回退设计决策
- [adr/2026-04-18-dag-reachability.md](../adr/2026-04-18-dag-reachability.md) — 可达性算法设计决策
- `core/orchestrator/schedule.js` — `isNodeReachable`、`isTaskFailed`、`isTaskCompleted` 实现
- `scripts/asr_transcribe.sh` / `scripts/asr_transcribe.py` — ASR 转录脚本
- `experiments/whisper_asr.py` — 早期独立实验脚本（手动使用）
