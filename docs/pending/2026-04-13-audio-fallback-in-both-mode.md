# TODO: audio fallback when video fails in `both` mode

## 背景

当 `mode=both` 时，`audio` 步骤被 `schedule.js` 的 `excludedByMode` 排除在外（设计意图：
video 步骤本身会同时下载视频+音频 DASH 流）。

但实测中 video 步骤因 YouTube 403 完全失败时，用户既没有视频也没有音频文件，
而 `audio` 步骤从未尝试过，也无法通过 `reset_scope` 单独触发。

## 问题

- `mode=both` 下 `audio` step 永远不进入调度器候选
- video 失败后没有任何媒体文件可用
- `reset_scope` 对 `audio` 无效（`applyResetScope` 会因 `excludedByMode` 抛 `BAD_ANCHOR_MODE`）

## 期望行为

当 `mode=both` 且 video 步骤最终失败时：
- 将 `audio` 步骤置为可调度，作为降级回退
- 或者在 video 脚本的最后一次失败后，自动尝试单独下载音频

## 涉及文件

- `core/orchestrator/schedule.js` — `excludedByMode()`、`computeReadySteps()`
- `core/orchestrator/index.js` — `runTask()` DAG 循环，step 失败处理
- `scripts/download_audio.sh` — audio 步骤脚本（已存在）

## 优先级

Low — 内容管线（transcript/article/summary）不受影响；仅影响媒体文件可用性。
