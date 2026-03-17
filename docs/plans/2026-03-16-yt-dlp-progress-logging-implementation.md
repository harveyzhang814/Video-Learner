# yt-dlp Progress Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不修改 SSE 事件类型和 GUI 逻辑的前提下，为 `video`/`audio` 步骤的 yt-dlp 下载过程增加节流后的进度日志，通过现有 `log.appended` 事件展示在 GUI 日志面板中。

**Architecture:** 在 orchestrator 的 `runStep` → `runStepScript` 调用链上，为 `video`/`audio` 步骤启用 yt-dlp 的 `--progress-template`，在 Node 层逐行解析进度输出、按时间和百分比双重阈值做节流，然后通过现有的 `emitOrchestratorEvent('log.appended', ...)` 推送 SSE 日志；HTTP 服务和 Electron 前端无需改动。

**Tech Stack:** Node.js（`child_process.spawn`）、bash 脚本（yt-dlp 调用）、yt-dlp `--progress-template`、现有 SSE 管线（Koa + EventStream）、Electron GUI。

---

### Task 1: 为 video/audio 步骤的 yt-dlp 调用加上统一 progress-template

**Files:**
- Modify: `scripts/download_video.sh`
- Modify: `scripts/download_audio.sh`

**Step 1: 找到 yt-dlp 调用点**

- 在 `scripts/download_video.sh` 中找到调用 yt-dlp 下载视频的命令行。
- 在 `scripts/download_audio.sh` 中找到调用 yt-dlp 下载音频的命令行。
- 确认两者使用 stdout/stderr 输出日志，并且当前不会对进度输出做额外的过滤（后续只在 Node 层解析）。

**Step 2: 为 yt-dlp 增加统一进度模板参数**

- 在 video/audio 两处 yt-dlp 调用中添加如下参数（保持其他参数不变）：

```bash
--newline \
--progress-template "[progress] downloaded=%(progress.downloaded_bytes)d total=%(progress.total_bytes or progress.total_bytes_estimate or 0)d speed=%(progress.speed or 0.0)f eta=%(progress.eta or 0)d"
```

- 约束：
  - 必须保留现有错误输出（stderr）行为；
  - 不改变下载目标路径和文件命名逻辑。

**Step 3: 手动验证脚本仍能正常下载**

- 运行一次视频下载：

```bash
bash scripts/download_video.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" "work/test_yt" "0"
```

- 运行一次音频下载：

```bash
bash scripts/download_audio.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" "work/test_yt" "0"
```

- 预期：
  - `work/test_yt/media` 下文件正常生成；
  - 终端中能看到若干以 `[progress] downloaded=... total=... speed=... eta=...` 开头的行。

**Step 4: Commit**

```bash
git add scripts/download_video.sh scripts/download_audio.sh
git commit -m "feat: enable yt-dlp progress template for media downloads"
```

---

### Task 2: 在 orchestrator 中为 video/audio 步骤接入行级 onOutput 钩子

**Files:**
- Modify: `core/orchestrator/index.js`

**Step 1: 为 runStep 传递 onOutput 钩子到 runStepScript**

- 在 `runStep` 函数中，构建 `args` 后、调用 `runStepScript` 的地方，增加 `onOutput` 透传（video/audio 专用）：
  - 对于 `stepName === 'video'` 或 `stepName === 'audio'`：
    - 构造一个包装函数 `onStepOutput(text)`，用于：
      - 原样调用 `options.onOutput && options.onOutput(text)`（保留现有行为）；
      - 将每一 chunk 按行切分后，交给后续 Task 3 的“进度解析器”处理。
  - 对其他步骤，沿用当前 `opts.onOutput: options.onOutput` 的逻辑，不做额外处理。

**Step 2: 保持现有 behavior 不变**

- 确保：
  - `runStepScript` 的签名不变（仍然接受 `opts.onOutput(text)`）；
  - 旧有的日志流（例如 `[STATUS] ...` 行）仍然完整写入 `result.output`，供 `formatStepError` 使用。

**Step 3: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "refactor: wire onOutput hook for video/audio steps"
```

---

### Task 3: 在 orchestrator 中实现 yt-dlp 进度行解析与节流

**Files:**
- Modify: `core/orchestrator/index.js`

**Step 1: 定义 per-step 进度状态结构**

- 在文件顶部或接近 `runStep` 的位置，定义一个简单的 in-memory 结构（例如 `const downloadProgressState = new Map();`），用于记录每个 `(taskId, stepName)` 的：
  - `lastSentAt`：上次发送进度日志时间戳（`ms`）。
  - `lastSentPercent`：上次发送的整数百分比（`0-100` 或 `null`）。

**Step 2: 实现辅助函数 parseProgressLine**

- 在 `core/orchestrator/index.js` 中新增函数：

```javascript
function parseYtDlpProgressLine(line) {
  const m = line.match(/^\[progress\]\s+downloaded=(\d+)\s+total=(\d+)\s+speed=([\d.]+)\s+eta=(\d+)/);
  if (!m) return null;
  const downloaded = Number(m[1]);
  const total = Number(m[2]);
  const speed = Number(m[3]);
  const eta = Number(m[4]);
  return { downloaded, total, speed, eta };
}
```

- 约定：非匹配行返回 `null`，由调用方忽略。

**Step 3: 实现辅助函数 formatProgressLog**

- 新增函数，用于将解析结果 + media 类型（video/audio）格式化为最终日志文本：

```javascript
function formatBytesToHuman(bytes) { /* B/KiB/MiB/GiB 转换 */ }

function formatEta(etaSecs) { /* 转 mm:ss，etaSecs <= 0 时可返回 null */ }

function formatDownloadProgressLog(kind, info) {
  const { downloaded, total, speed, eta, percent } = info;
  const humanDownloaded = formatBytesToHuman(downloaded);
  const humanTotal = total > 0 ? formatBytesToHuman(total) : null;
  const humanSpeed = speed > 0 ? `${formatBytesToHuman(speed)}/s` : null;
  const humanEta = formatEta(eta);

  if (total > 0 && typeof percent === 'number') {
    // e.g. [video] progress: 35% (42.3 MiB / 120.0 MiB, 3.2 MiB/s, eta 00:45)
    const parts = [];
    parts.push(`${humanDownloaded} / ${humanTotal}`);
    if (humanSpeed) parts.push(humanSpeed);
    if (humanEta) parts.push(`eta ${humanEta}`);
    return `[${kind}] progress: ${percent}% (${parts.join(', ')})`;
  }

  // total unknown
  const parts = [];
  parts.push(humanDownloaded);
  if (humanSpeed) parts.push(humanSpeed);
  parts.push('total size unknown');
  return `[${kind}] progress: downloaded ${parts.join(', ')}`;
}
```

**Step 4: 实现节流逻辑并调用 emitOrchestratorEvent**

- 在 Task 2 中注入的 `onStepOutput(text)` 中：
  - 将 `text` 按行拆分，对每一行：
    - 先调用 `parseYtDlpProgressLine(line)`：
      - 若返回 `null`：只做原样日志转发，不做进度处理；
      - 若解析到 `{ downloaded, total, speed, eta }`：
        - 计算：
          - `percent = total > 0 ? Math.max(0, Math.min(100, Math.round((downloaded / total) * 100))) : null;`
        - 从 `downloadProgressState` 中取出 `(taskId, stepName)` 对应的 `{ lastSentAt, lastSentPercent }`，默认 `0` / `null`。
        - 计算 `now = Date.now()` 和 `deltaMs = now - lastSentAt`。
        - 判定是否需要发送：
          - 当 `percent != null`：
            - 若 `lastSentPercent == null` → 一定发送；
            - 否则，若 `deltaMs >= 1000` **或** `Math.abs(percent - lastSentPercent) >= 1` → 发送；
          - 当 `percent == null`：
            - 若 `deltaMs >= 1000` → 发送。
        - 若判定“发送”：
          - 调用 `formatDownloadProgressLog(stepName === 'video' ? 'video' : 'audio', { downloaded, total, speed, eta, percent })` 得到文本。
          - 调用已有的 `emitOrchestratorEvent('log.appended', taskId, { line: formatted, level: 'info' /* seq 保留在 HTTP 层或后续扩展 */ });`
          - 更新 `downloadProgressState` 中的 `lastSentAt` 和 `lastSentPercent`。

**Step 5: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "feat: add throttled yt-dlp progress logging for video/audio steps"
```

---

### Task 4: 在步骤开始/结束时清理进度状态（避免跨任务/跨重试串状态）

**Files:**
- Modify: `core/orchestrator/index.js`

**Step 1: 在 runStep 开始时重置当前 step 的进度状态**

- 在 `runStep` 里、刚将 `stepState.status` 设为 `running` 且发出 `step.started` 之前，增加：
  - 对当前 `(taskId, stepName)` 在 `downloadProgressState` 中的记录执行重置：
    - `lastSentAt = 0`，`lastSentPercent = null`。

**Step 2: 在步骤结束时可以选择清理状态（可选）**

- 在 `runStep` 的末尾（`emitOrchestratorEvent('step.finished', ...)` 后），可选地：
  - 从 `downloadProgressState` 中删除 `(taskId, stepName)` 项；
  - 或保留不删，仅依赖下一次执行时的重置。
- 简化选择：**保留不删，只在每次 runStep 开头重置**，避免额外复杂度。

**Step 3: Commit**

```bash
git add core/orchestrator/index.js
git commit -m "chore: reset progress state at step start"
```

---

### Task 5: 手动端到端验证（长视频下载）

**Files:**
- No code changes（手动验证）

**Step 1: 启动 HTTP 服务与 Electron GUI**

- 在项目根目录：

```bash
npm run agent:serve   # 或当前用于启动 services/http-server 的命令
npm run electron      # 或当前用于启动 GUI 的命令
```

（具体命令以仓库现有 script 为准，此处仅为示意）

**Step 2: 在 GUI 中创建一个较长视频任务**

- 在 GUI 中点击 `+ New`，填入一个时长较长的 YouTube URL。
- 选择 `Resource = video` 或 `both`，点击 Run。

**Step 3: 观察下载过程中的日志面板**

- 在 Manage 弹窗 / 日志面板中确认：
  - 当 `video` 步骤运行时，约每 1 秒能看到一条类似以下格式的日志行：

```text
[video] progress: 12% (xx.x MiB / xxx.x MiB, x.x MiB/s, eta 01:23)
```

  - 当网络变慢时，日志仍持续更新但百分比增长放缓；
  - 若中途断网，进度行停止刷新，最终 `video` 步骤以失败结束并有错误日志。

**Step 4: 对 audio 模式做同样验证**

- 创建 `mode = audio` 的任务，确认：
  - 只在 `audio` 步骤期间出现 `[audio] progress: ...` 日志；
  - 频率、格式与 video 一致。

**Step 5: Commit（如有必要调整文案/节流参数）**

```bash
git commit -am "chore: tune yt-dlp progress logging based on manual e2e verification"
```

---

### Task 6: 增加针对进度日志的自动化测试（最小单元）

**Files:**
- Create/Modify: `tests/orchestrator-progress-logging.test.js`（名称可按现有测试风格调整）

**Step 1: 为 parseYtDlpProgressLine 编写纯单元测试**

- 测试输入：

```text
[progress] downloaded=1024 total=2048 speed=512.0 eta=10
```

- 断言：
  - 能解析出正确的数字；
  - 对非进度行返回 `null`。

**Step 2: 为节流逻辑编写最小集成测试（可模拟时间）**

- 构造一个假的 `(taskId, stepName)` 和一系列行：
  - 百分比快速连续变化，如 1%、1%、2%、2%、3%...
  - 手动控制 `Date.now()`（通过注入或使用简单的时间 stub）来模拟 `< 1s` / `>= 1s` 场景。
- 验证：
  - 重复百分比、时间间隔 < 1s 的情况下不会多次触发 `emitOrchestratorEvent`；
  - 当时间或百分比阈值满足时会触发。

**Step 3: Commit**

```bash
git add tests/orchestrator-progress-logging.test.js core/orchestrator/index.js
git commit -m "test: cover yt-dlp progress parsing and throttling"
```

---

## 执行选项

Plan complete and saved to `docs/plans/2026-03-16-yt-dlp-progress-logging-implementation.md`. Two execution options:

1. **Subagent-Driven (this session)** - 我在当前会话里按任务拆分执行，每个 Task 一次小步更改 + 测试 + 小提交，中间和你确认关键点。
2. **Parallel Session (separate)** - 你在新的 Cursor 会话里打开同一工作树，使用 superpowers:executing-plans，一步步按本计划执行，有独立的实现节奏。

你更想用哪种方式来落地这个 plan？

