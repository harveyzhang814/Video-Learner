# GUI 本地播放器与字幕模块 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 选中任务后，右侧播放器用本地 file URL 播放 video.mp4，播放器下方展示多轨字幕列表（可点击跳转、与视频联动高亮/滚动），支持画面内字幕开关与多轨切换（≤2 按钮、>2 下拉）。

**Architecture:** http-server 新增 GET media（返回 path+exists）与 GET subtitles（一次性返回多轨完整 vtt 文本）；ServiceClient 增加 getTaskMedia/getTaskSubtitles；渲染进程在 selectTask 时拉取并设置 video.src（前端拼 file://）、解析 VTT、渲染列表、timeupdate 联动、TextTrack/VTTCue 画面字幕、轨道选择 UI。

**Tech Stack:** Koa, Node fs/path, fetch, HTML5 Video/TextTrack/VTTCue, 现有 ServiceClient（ESM）。

---

## Task 1: http-server 新增 GET /api/tasks/:taskId/media

**Files:**
- Modify: `services/http-server/index.js`（在现有 `/tasks/:taskId/result` 或 `/result/content` 附近）

**Step 1: 实现路由**
- 调用 `orchestrator.getTaskResult(taskId, { rootDir: ROOT_DIR })` 取 `result.outputs.video_path` 与 `result.meta.id`。
- 白名单路径：`path.resolve(ROOT_DIR, 'work', result.meta.id, 'media', 'video.mp4')`，normalize 后严格等于才放行。
- 若 task 不存在（getTaskResult 抛错）→ 404。
- 返回 200 + `{ video: { path: allowedPath, exists: fs.existsSync(allowedPath) } }`（path 为绝对路径字符串）。

**Step 2: 验证**
- 启动服务后，对已有 video 的任务：`curl -H "Authorization: Bearer TOKEN" http://127.0.0.1:PORT/api/tasks/TASK_ID/media` 应返回 200 且 `exists: true`；对无视频任务 `exists: false`。

**Step 3: Commit**
- `git add services/http-server/index.js && git commit -m "feat(api): GET /api/tasks/:id/media returns path and exists"`

---

## Task 2: http-server 新增 GET /api/tasks/:taskId/subtitles

**Files:**
- Modify: `services/http-server/index.js`

**Step 1: 实现路由**
- getTaskResult 取 `meta.id`，transcript 目录 `path.resolve(ROOT_DIR, 'work', id, 'transcript')`。
- 白名单文件名：仅 `original_zh.vtt`、`original_en.vtt`（或扫描 transcript 下 `*.vtt` 且 basename 在白名单/允许列表内）。
- 对每个允许的 vtt 文件，若存在则 `fs.readFileSync(..., 'utf8')`，推入 `tracks`: `{ id: basename 去掉 .vtt, lang, label, vtt }`（label 可写死「中文」「English」或从 id 推导）。
- 返回 200 + `{ tracks: [...] }`；task 不存在 404。

**Step 2: 验证**
- 对已完成 md2vtt 的任务请求 subtitles，应返回 200 且 tracks 含至少一条带 `vtt` 文本的项。

**Step 3: Commit**
- `git add services/http-server/index.js && git commit -m "feat(api): GET /api/tasks/:id/subtitles returns tracks with full vtt text"`

---

## Task 3: ServiceClient 新增 getTaskMedia、getTaskSubtitles

**Files:**
- Modify: `electron/src/renderer/service-client.js`

**Step 1: 实现**
- `getTaskMedia(taskId)`：`_fetchJson(\`/api/tasks/${encodeURIComponent(taskId)}/media\`)`，返回 `{ video: { path, exists } }`。
- `getTaskSubtitles(taskId)`：`_fetchJson(\`/api/tasks/${encodeURIComponent(taskId)}/subtitles\`)`，返回 `{ tracks }`。

**Step 2: 验证**
- 在现有 test:gui:client:http 或手动调用确认返回结构正确。

**Step 3: Commit**
- `git add electron/src/renderer/service-client.js && git commit -m "feat(gui): ServiceClient getTaskMedia and getTaskSubtitles"`

---

## Task 4: 前端 — 选中任务时拉取 media、拼 file URL、设置 video 与占位

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: selectTask 内拉取 media**
- 在 selectTask 中，拿到 task 后调用 `client.getTaskMedia(taskId)`。
- 若 `video.exists && video.path`：将 path 转为 file URL（注意：在 Electron 渲染进程，可用 `'file://' + path` 或按平台处理；Windows 需多一路径分隔符/转义，此处以 macOS/Linux 为例）。赋值 `videoPlayer.src = fileUrl`，显示 video、隐藏 videoEmpty。
- 否则：清空 `videoPlayer.src`，显示 videoEmpty，隐藏 video。
- 若当前有字幕 track（画面内），先清空或 disable，避免旧任务残留。

**Step 2: path → file URL 的兼容**
- 文档约定：path 为绝对路径；`fileUrl = 'file://' + encodeURI(path).replace(/^\/+/, '/')` 或使用 Node 的 pathToFileURL（仅在 main/preload 可用时）；若只在渲染进程，可用简单 `'file://' + path`，必要时对空格等编码。

**Step 3: Commit**
- `git add electron/src/renderer/index.html && git commit -m "feat(gui): load task video from media API and set file URL"`

---

## Task 5: 前端 — VTT 解析与字幕列表渲染

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 实现 VTT 解析函数**
- 输入 vtt 字符串，输出 `cues: Array<{ startSec, endSec, text }>`。
- 跳过 WEBVTT 头、NOTE/STYLE/REGION；解析 `HH:MM:SS.mmm --> HH:MM:SS.mmm` 或 `MM:SS.mmm` 形式；多行文本合并为 text。

**Step 2: 拉取字幕并渲染列表**
- 在 selectTask 中（或 video 已就绪后）调用 `client.getTaskSubtitles(taskId)`。
- 默认选第一条 track（或上次选择的 trackId 若仍存在）；解析该 track 的 vtt → cues。
- 渲染 `#subtitleList`：每个 cue 一个 `.subtitle-item`，显示时间戳（mm:ss）与 text；点击时 `video.currentTime = cue.startSec + 0.01`，可选 `video.play()`。

**Step 3: 轨道选择 UI**
- 若 `tracks.length <= 2`：使用现有 language-switcher 两个按钮，绑定 trackId。
- 若 `tracks.length > 2`：隐藏按钮，显示 `<select>` 下拉，选项为 tracks，切换时更新当前 track、重新解析并渲染列表，不改变 video.currentTime。

**Step 4: Commit**
- `git add electron/src/renderer/index.html && git commit -m "feat(gui): parse VTT, render subtitle list, track switcher (buttons or select)"`

---

## Task 6: 前端 — timeupdate 联动高亮与自动滚动

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 维护 active cue 索引**
- 监听 `videoPlayer.timeupdate`；用 currentTime 与当前 cues 数组计算当前应为哪一条（二分查找 startSec 或线性指针推进）。
- 当 active 索引变化时：移除其他 .subtitle-item.active，为对应项加 .active；调用 `activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' })`（节流：仅 active 变化时执行）。

**Step 2: 边界**
- 无 cues 或未选轨道时不更新；切换任务时移除监听或重置 cues。

**Step 3: Commit**
- `git add electron/src/renderer/index.html && git commit -m "feat(gui): subtitle list timeupdate highlight and auto-scroll"`

---

## Task 7: 前端 — 画面内字幕开关（TextTrack + VTTCue）

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 增加开关 UI**
- 在字幕模块头部（如 subtitle-header 内）增加「画面内字幕」开关（checkbox 或 toggle）；状态存于变量或 data 属性。

**Step 2: 开关 On 时注入 TextTrack**
- 使用 `video.addTextTrack('subtitles', trackLabel, trackLang)` 创建轨道；遍历当前 cues，`track.addCue(new VTTCue(startSec, endSec, text))`；`track.mode = 'showing'`。
- 切换轨道时：若开关 On，移除或禁用旧 track，用新轨道 cues 创建新 TextTrack 并设为 showing。

**Step 3: 开关 Off**
- 将当前 track.mode = 'disabled'，或移除该 track（实现时二选一，以不报错为准）。

**Step 4: Commit**
- `git add electron/src/renderer/index.html && git commit -m "feat(gui): on-screen subtitle toggle via TextTrack/VTTCue"`

---

## 验收与回归

- 每 Task 后运行 `npm run test:gui`（或现有 GUI 相关测试）确保无回归。
- 人工验收：选中含 video 与 md2vtt 产物的任务，视频能播放、字幕列表可点击跳转、高亮与滚动正确、切换轨道与画面内字幕开关生效。
