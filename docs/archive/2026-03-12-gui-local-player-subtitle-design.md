# GUI 本地播放器与字幕模块设计

> 目标：选中任务后，在右侧播放器播放任务产物 `video.mp4`，并在播放器下方展示 md2vtt 生成的多轨字幕；支持可点击字幕列表、与视频联动高亮/滚动、画面内字幕开关、多轨切换（≤2 用按钮，>2 用下拉）。

---

## 1. 范围与约束

- **视频**：仅播放任务产物 `work/<id>/media/video.mp4`；不要求 http-server 提供视频字节流（无 Range）。
- **字幕**：来源为 md2vtt 生成的 VTT 文件（如 `work/<id>/transcript/original_zh.vtt`、`original_en.vtt`）；http-server 一次性返回各轨道完整 VTT 文本；前端负责解析、列表渲染、联动与画面内显示。
- **agent-service**：不受影响；视频播放与字幕能力为 GUI 专用。

---

## 2. 服务端接口（http-server）

### 2.1 视频路径接口

- **路径**：`GET /api/tasks/:taskId/media`
- **鉴权**：与现有 `/api` 一致（Authorization Bearer token）。
- **返回**：
  - 200 + JSON：`{ "video": { "path": "/abs/.../work/<id>/media/video.mp4", "exists": true } }`
  - 只返回 `path`；前端自行拼接 `file://` URL 用于 `<video>.src`（注意路径转义：空格、中文等）。
- **校验**：路径必须严格落在 `work/<id>/media/video.mp4`（白名单）；`exists` 由 `fs.existsSync` 得出；task 不存在则 404。

### 2.2 字幕接口（一次性返回多轨完整 VTT）

- **路径**：`GET /api/tasks/:taskId/subtitles`
- **鉴权**：同上（Bearer）。
- **返回**：
  - 200 + JSON：`{ "tracks": [ { "id": "original_zh", "lang": "zh", "label": "中文", "vtt": "WEBVTT...\n..." }, ... ] }`
  - 每轨 `vtt` 为完整文件内容；仅包含实际存在的文件（缺失的轨道不出现在 `tracks`）。
- **白名单**：仅允许读取 `work/<id>/transcript/` 下约定的 VTT（如 `original_zh.vtt`、`original_en.vtt`）；可扩展为扫描该目录下 `*.vtt`，但仍限制在 transcript 内。
- **错误**：task 不存在 404；路径校验失败 500（不暴露内部路径）。

---

## 3. 前端设计

### 3.1 视频播放

- 调用 `getTaskMedia(taskId)` 得到 `video.path`、`video.exists`。
- 若 `exists`：`videoPlayer.src = 'file://' + encodePath(path)`（或项目采用的 path→fileURL 方式）。
- 若不存在：显示占位「No video」，不设置 src。

### 3.2 字幕数据与解析

- 调用 `getTaskSubtitles(taskId)` 得到 `tracks`。
- 前端解析每条轨道的 `vtt` 文本 → `cues: Array<{ startSec, endSec, text }>`（支持 `hh:mm:ss.mmm` / `mm:ss.mmm`，忽略 WEBVTT 头、NOTE/STYLE/REGION）。

### 3.3 字幕展示模块（播放器下方）

- 布局：沿用现有 `#subtitleModule`（在 video 控件下方）。
- **轨道选择**：
  - `tracks.length <= 2`：保留两个按钮（如 中文 / English）。
  - `tracks.length > 2`：改为 `<select>` 下拉框。
- **列表**：当前轨道的 cues 渲染为 `#subtitleList` 下的 `.subtitle-item`（时间戳 + 文本）；点击某条 → `video.currentTime = cue.startSec + ε`，可选自动 play。

### 3.4 与视频联动

- 监听 `<video>` 的 `timeupdate`；用 `currentTime` 确定当前 active cue（建议二分或指针推进，避免每帧全量遍历）。
- active 变化时：高亮对应 `.subtitle-item.active`；`scrollIntoView({ block: 'center', behavior: 'smooth' })`（仅 active 变化时滚动，避免抖动）。

### 3.5 画面内字幕（开关控制）

- **开关**：UI 增加「画面内字幕」开关（On/Off）。
- **On**：使用 `video.addTextTrack('subtitles', label, lang)` 创建轨道，将当前轨道的 cues 注入为 `new VTTCue(start, end, text)`，`track.mode = 'showing'`。
- **Off**：`track.mode = 'disabled'`（或清空 cues）。
- 切换轨道时：若开关 On，同步更新画面字幕 track（清空旧 cues，注入新轨道的 cues）；不改变 `video.currentTime`。

---

## 4. 错误与边界

- 任务不存在：media/subtitles 均 404。
- 视频文件不存在：media 仍 200，`exists: false`；前端显示占位。
- 某 VTT 不存在：该轨道不出现在 `tracks`，前端不展示该选项。
- 路径校验失败：500，不暴露真实路径。

---

## 5. 参考

- 现有 `GET /api/tasks/:taskId/result`、`/result/content` 的鉴权与路径校验方式。
- `core/orchestrator`：`getTaskResult` 与 `outputs`（video_path、transcript 目录结构）；md2vtt 产出 `original_zh.vtt` / `original_en.vtt`。
- `electron/src/renderer/index.html`：`#videoPlayer`、`#subtitleModule`、`#subtitleList`、language-switcher。
