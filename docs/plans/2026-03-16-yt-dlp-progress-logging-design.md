## yt-dlp 下载步骤进度 SSE 日志设计

> 目标：在不增加新的 SSE 事件类型、不改 GUI 逻辑的前提下，为 **video/audio 下载步骤** 提供稳定的下载进度日志，用于判断任务是否「在动」还是「卡死」。

---

### 1. 范围与约束

- **作用范围**
  - 仅针对 orchestrator 中使用 **yt-dlp** 的下载步骤：
    - `video`：视频文件下载
    - `audio`：音频文件下载
- **不做的事情**
  - 不新增 SSE 事件类型（仍然只用 `log.appended`）。
  - 不改 GUI 渲染逻辑（日志仍然只是文本列表）。
  - 不覆盖/篡改现有错误日志与摘要输出。

---

### 2. yt-dlp 命令行进度输出模板

统一为 video/audio 两类下载步骤启用一个固定的进度输出格式，方便 Node/shell 层解析。

#### 2.1 命令行参数约定

在 yt-dlp 命令中增加：

```bash
--newline \
--progress-template "[progress] downloaded=%(progress.downloaded_bytes)d total=%(progress.total_bytes or progress.total_bytes_estimate or 0)d speed=%(progress.speed or 0.0)f eta=%(progress.eta or 0)d"
```

含义：

- `--newline`：每次进度刷新输出一整行，便于流式解析。
- `--progress-template`：统一输出格式为单行文本：

```text
[progress] downloaded=<int> total=<int> speed=<float> eta=<int>
```

- 字段语义：
  - `downloaded_bytes`：当前已下载字节数（整数）。
  - `total_bytes`：总字节数；若拿不到则回退为 estimate，再不行则为 `0`。
  - `speed`：当前下载速度（字节/秒，浮点数；缺失时为 `0.0`）。
  - `eta`：预计剩余秒数；缺失时为 `0`。

---

### 3. 进度解析与节流逻辑（Node/shell 层）

在负责运行 yt-dlp 并消费其 stdout 的层（Node child_process 或 bash 包装）中，增加对进度行的解析与节流。

#### 3.1 行解析规则

- 对每一行 stdout 执行正则匹配：

```text
/^\[progress\]\s+downloaded=(\d+)\s+total=(\d+)\s+speed=([\d.]+)\s+eta=(\d+)/
```

- 若匹配成功，解析得到：
  - `downloaded_bytes` `total_bytes` `speed_bps` `eta_secs`
- 非 `[progress]` 行维持现有日志处理逻辑，不做特殊处理。

#### 3.2 进度计算

- 当 `total_bytes > 0` 时：
  - `percent_raw = downloaded_bytes / total_bytes * 100`
  - `percent = clamp(round(percent_raw), 0, 100)`
- 当 `total_bytes == 0` 时：
  - 视为「未知总大小」，不计算百分比：
  - `percent = null`

#### 3.3 节流策略

为单个下载步骤维护进度发送状态：

- `lastSentAt`：上一次发送进度日志的时间戳（`ms`）。
+- `lastSentPercent`：上一次发送的整数百分比（或 `null`）。

每解析到一条进度行时：

1. 计算 `now = Date.now()` 和 `deltaMs = now - lastSentAt`。
2. 若 `percent != null`：
   - 若 `lastSentPercent == null`：**强制发送一次**（首次进度）。
   - 否则，当满足任一条件时发送：
     - `deltaMs >= 1000`（距离上次发送 ≥ 1 秒），或
     - `abs(percent - lastSentPercent) >= 1`（进度至少变化 1 个百分点）。
3. 若 `percent == null`（未知总大小）：
   - 仅按时间节流：`deltaMs >= 1000` 时发送。

发送后更新：

- `lastSentAt = now`
- `lastSentPercent = percent`（可为 `null`）。

---

### 4. SSE 日志文本格式（面向 GUI）

所有下载进度信息都通过现有的 `log.appended` 事件以**人类可读的文本行**呈现，GUI 只是多出一些普通的日志行，无需改动。

#### 4.1 统一文案格式

- 若 `percent != null` 且总大小已知：

```text
[video] progress: 35% (42.3 MiB / 120.0 MiB, 3.2 MiB/s, eta 00:45)
```

```text
[audio] progress: 10% (3.1 MiB / 30.0 MiB, 1.1 MiB/s, eta 02:10)
```

- 若 `percent == null`（总大小未知）：

```text
[video] progress: downloaded 42.3 MiB (3.2 MiB/s, total size unknown)
```

#### 4.2 字段格式建议

- **字节数 → 人类可读大小**
  - 以 `1024` 为基数：
    - `< 1024` → `B`
    - `< 1024^2` → `KiB`
    - `< 1024^3` → `MiB`
    - 否则 → `GiB`
- **速度**
  - 同上单位并加 `/s`，例如：`3.2 MiB/s`。
  - 若 `speed_bps <= 0` 或非数值，可降级为 `speed --` 或直接省略。
- **ETA**
  - 将 `eta_secs` 转为 `mm:ss`，例如：`00:45` / `02:13`。
  - 当 `eta_secs == 0` 或明显无效时可省略 ETA 字段。

---

### 5. SSE 事件结构（兼容现有前端）

不新增事件类型，统一使用 `log.appended`：

- 在 orchestrator 或下载包装层内发送：

```js
onEvent({
  type: 'log.appended',
  taskId,
  payload: {
    line: '[video] progress: 35% (42.3 MiB / 120.0 MiB, 3.2 MiB/s, eta 00:45)',
    seq: nextSeq(),   // 复用现有 seq 去重机制
    level: 'info'
  }
});
```

- GUI 侧行为：
  - 将该行当作普通日志行渲染在当前任务的日志面板里；
  - 用户可以通过「日志是否在过去数秒持续出现 progress 行」判断任务是慢但在跑，还是已经卡死。
  - 未来若需要进度条，可在前端解析 `[video] progress: <percent>%` 文本进一步增强 UI（本设计不要求实现）。

---

### 6. 边界与失败场景约定

#### 6.1 总大小未知

- 当 yt-dlp 只提供估算或完全没有总大小时：
  - `total_bytes` 最终为 `0`。
  - 仅输出「已下载大小 + 速率」：

```text
[video] progress: downloaded 42.3 MiB (3.2 MiB/s, total size unknown)
```

- 仍然按照「每 ≥ 1 秒一次」的时间节流规则发送，帮助识别「是否在动」。

#### 6.2 下载重试

- 若 orchestrator 对某个 `video`/`audio` 步骤执行重试：
  - 每次重试前重置该步骤的：
    - `lastSentAt`
    - `lastSentPercent`
  - 可以在重试开始时发一条普通日志，便于区分多次尝试：

```text
[video] retry #2 starting…
```

#### 6.3 用户终止 / 异常失败

- 当用户主动中止下载或发生致命错误时：
  - 保持现有 `step.failed` 事件逻辑不变；
  - 补充一条明确的日志行：

```text
[video] download aborted by user
```

```text
[video] download failed: <reason>
```

- 这类日志同样通过 `log.appended` 推送，便于在 GUI 中一眼看出「失败原因」与「非卡死而是终止」。

---

### 7. 实现注意点（供后续实现计划使用）

- 修改集中在：
  - orchestrator 中封装 yt-dlp 下载的步骤实现；
  - 将 yt-dlp 进度行解析为结构化数据，并按本设计节流后转换为 `log.appended`。
- 不改动：
  - `services/http-server` 的 SSE 管线；
  - `electron/src/renderer` 中现有 SSE 事件处理和日志渲染逻辑。
- 验证建议：
  - 使用一个较长的视频 URL 做手动测试：
    - 观察 GUI 日志面板是否约每秒出现一次进度行；
    - 人为断网验证进度行停止并最终收到失败日志；
    - 确认日志量不会导致 GUI 卡顿。

