# Unified Task Logs (task.log.jsonl + per-step raw)

## Background
现有日志主要依赖：
- 服务化链路：SSE `log.appended` 只覆盖 `video/audio` 的 yt-dlp 进度（节流后人类可读行）
- CLI 链路：只有 `download_video.sh` 有明确的 `work/<id>/media/video_download.log` 落盘；其它步骤输出不统一且部分被 `2>/dev/null` 丢弃

用户期望：**将每个步骤及其子输出（如 `download_video.sh` 内 yt-dlp/ffmpeg 输出）都归档到同一处**，并进一步以 JSONL 结构化便于检索与复盘；同时不改 UI。

## Goals
1. 为每个任务 `work/<id>/logs/` 提供统一归档目录
2. 所有步骤（`fetch/video/audio/subs/vtt2md/md2vtt/article/summary`）的 stdout/stderr 子输出都进入归档
3. `task.log.jsonl` 汇总所有日志行（JSONL，可筛选/检索）
4. 每个步骤仍提供 `*.raw.log` 供人工排查（保留原始行）
5. JS/agent 在写入 JSONL 时按“必要且可稳定识别”的原则细分 `source/level/progress`；不做过度、易误判的细分

## Storage Layout
`work/<id>/logs/`
- `task.log.jsonl`：全量汇总（JSONL）
- `<step>.raw.log`：每个步骤原始输出（stdout/stderr 混合，按行落盘）

## JSONL schema (one record per line)
每行 JSON 对象：
- `ts` (string): ISO timestamp（写入时刻）
- `step` (string): step name
- `stream` (string): `stdout|stderr|unknown`（CLI 可为 `unknown`；服务化可区分）
- `source` (string): `yt-dlp|ffmpeg|script/other`
- `level` (string): `info|warn|error|debug`（启发式，无法识别则为 `info`）
- `line` (string): 原始日志行（不去重）
- `progress` (object|undefined): 仅当识别到 yt-dlp 进度模板时存在
  - `{ downloaded, total, speed, eta, percent }`

## Parsing / Classification Rules (agent-side)
1. yt-dlp 进度（必须）：复用现有 `parseYtDlpProgressLine()` 的正则风格
   - 识别 `[progress] downloaded=... total=... speed=... eta=...`
   - 写入 `source=yt-dlp`，并在 `progress` 中输出结构化字段
2. ffmpeg（可选且仅在稳定时刻启用）：
   - 若行中包含常见片段（如 `frame=` 且 `time=`），则 `source=ffmpeg`
   - 不稳定时保持 `script/other`，避免误判
3. level（启发式）：
   - 匹配 `error|failed|Error|Failed|exception` => `error`
   - 匹配 `warn|WARNING` => `warn`
   - 否则 `info`

## Service Chain Changes (core/orchestrator)
修改点：
1. `ensureWorkSubdirs()`：新增 `work/<id>/logs`
2. `runStepScript()`：把 stdout/stderr 以行级粒度传递给上层（可选 stream 参数）
3. `runStep()`：在执行每个 step 时：
   - 写入 `<step>.raw.log`（逐行）
   - 同步把行解析后追加到 `task.log.jsonl`（JSONL 追加）
   - 保持现有 SSE `log.appended` 行为不变（UI 不改）

视频与音频进度：
- 保持现有 yt-dlp 进度节流 SSE（仍然只为 video/audio）
- 但 raw/JSONL 不节流：yt-dlp 子输出全量落盘并结构化（progress 可选字段）

## CLI Chain Changes (scripts/run.sh)
修改点：
1. 新增 `logs/` 目录创建：`$DIR/logs`
2. `video`：保留现有 `nohup ... > media/video_download.log`；
   - 后置归档：下载完成后读取 `media/video_download.log`，追加到 `logs/task.log.jsonl`
3. `audio`/`transcript`/`article`/`summary`：
   - 将当前被 `2>/dev/null` 丢弃的 stdout/stderr 改为写入对应 `<step>.raw.log`
   - 最终汇总追加到 `task.log.jsonl`

映射策略（CLI 内部细分）：
- transcript 是一个较大的 bash 函数，CLI 无单独的 subs/vtt2md/md2vtt 外部脚本；
  为确保落地，CLI 将该阶段整体归档到 `step=subs`（包含其 yt-dlp/转换输出）

## Testing Plan
1. 单任务本地跑通：
   - 跑一个 URL（MODE=both 或 full_flow_transcript），验证：
     - `work/<id>/logs/task.log.jsonl` 存在且可 parse
     - `work/<id>/logs/video.raw.log`/`audio.raw.log` 等存在
     - `download_video.sh` 内 yt-dlp/ffmpeg 输出能在 JSONL 中出现（source=yt-dlp/ffmpeg）
2. 回归：
   - SSE `log.appended` 行为不变
   - transcript/article/summary 的原产物不受影响

