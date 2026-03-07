# Frontend Status Pills 8 Steps 对齐实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将前端状态 tag pills 更新为 8 个，与 Orchestrator 的 8 个 Steps 完全对齐

**Architecture:** 直接修改 `electron/src/renderer/index.html`，更新 HTML 结构和 JavaScript 逻辑

**Tech Stack:** Vanilla JavaScript, HTML

---

## 准备

先检查当前分支，确保在 feature 分支上工作：

```bash
git branch
```

如果不是 feature 分支，创建新分支：
```bash
git checkout -b feature/frontend-status-pills-8steps
```

---

## 任务清单

### Task 1: 更新 infoStatus pills (获取信息区域)

**Files:**
- Modify: `electron/src/renderer/index.html:1284-1301`

**Step 1: 查看当前代码**

```html
<!-- 当前 4 个 pills -->
<div class="info-status" id="infoStatus">
  <span class="status-pill" data-step="video">
    <span class="icon">○</span>
    <span class="label">视频</span>
  </span>
  <span class="status-pill" data-step="transcript">
    <span class="icon">○</span>
    <span class="label">转录</span>
  </span>
  <span class="status-pill" data-step="article">
    <span class="icon">○</span>
    <span class="label">文章</span>
  </span>
  <span class="status-pill" data-step="summary">
    <span class="icon">○</span>
    <span class="label">总结</span>
  </span>
</div>
```

**Step 2: 替换为 8 个 pills**

```html
<div class="info-status" id="infoStatus">
  <span class="status-pill" data-step="fetch">
    <span class="icon">○</span>
    <span class="label">获取信息</span>
  </span>
  <span class="status-pill" data-step="video">
    <span class="icon">○</span>
    <span class="label">视频下载</span>
  </span>
  <span class="status-pill" data-step="audio">
    <span class="icon">○</span>
    <span class="label">音频下载</span>
  </span>
  <span class="status-pill" data-step="subs">
    <span class="icon">○</span>
    <span class="label">字幕下载</span>
  </span>
  <span class="status-pill" data-step="vtt2md">
    <span class="icon">○</span>
    <span class="label">转换文案</span>
  </span>
  <span class="status-pill" data-step="md2vtt">
    <span class="icon">○</span>
    <span class="label">转寒字幕</span>
  </span>
  <span class="status-pill" data-step="article">
    <span class="icon">○</span>
    <span class="label">文章生产</span>
  </span>
  <span class="status-pill" data-step="summary">
    <span class="icon">○</span>
    <span class="label">提炼总结</span>
  </span>
</div>
```

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "feat(frontend): update infoStatus pills to 8 steps"
```

---

### Task 2: 更新 progressSteps (进度条区域)

**Files:**
- Modify: `electron/src/renderer/index.html:1322-1329`

**Step 1: 查看当前代码**

```html
<div class="progress-steps">
  <div class="progress-step" data-step="info"><span class="dot"></span>Info</div>
  <div class="progress-step" data-step="video"><span class="dot"></span>Video</div>
  <div class="progress-step" data-step="audio"><span class="dot"></span>Audio</div>
  <div class="progress-step" data-step="transcript"><span class="dot"></span>Transcript</div>
  <div class="progress-step" data-step="article"><span class="dot"></span>Article</div>
  <div class="progress-step" data-step="summary"><span class="dot"></span>Summary</div>
</div>
```

**Step 2: 替换为 8 个 steps**

```html
<div class="progress-steps">
  <div class="progress-step" data-step="fetch"><span class="dot"></span>Fetch</div>
  <div class="progress-step" data-step="video"><span class="dot"></span>Video</div>
  <div class="progress-step" data-step="audio"><span class="dot"></span>Audio</div>
  <div class="progress-step" data-step="subs"><span class="dot"></span>Subs</div>
  <div class="progress-step" data-step="vtt2md"><span class="dot"></span>VTT2MD</div>
  <div class="progress-step" data-step="md2vtt"><span class="dot"></span>MD2VTT</div>
  <div class="progress-step" data-step="article"><span class="dot"></span>Article</div>
  <div class="progress-step" data-step="summary"><span class="dot"></span>Summary</div>
</div>
```

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "feat(frontend): update progressSteps to 8 steps"
```

---

### Task 3: 更新 modal-status pills (模态框状态)

**Files:**
- Modify: `electron/src/renderer/index.html:1419-1441`

**Step 1: 查看当前代码**

```html
<span class="status-pill" data-step="info">
  <span class="icon">○</span>
  <span class="label">Info</span>
</span>
<span class="status-pill" data-step="video">
  <span class="icon">○</span>
  <span class="label">Video</span>
</span>
<span class="status-pill" data-step="audio">
  <span class="icon">○</span>
  <span class="label">Audio</span>
</span>
<span class="status-pill" data-step="transcript">
  <span class="icon">○</span>
  <span class="label">Transcript</span>
</span>
<span class="status-pill" data-step="article">
  <span class="icon">○</span>
  <span class="label">Article</span>
</span>
<span class="status-pill" data-step="summary">
  <span class="icon">○</span>
  <span class="label">Summary</span>
</span>
```

**Step 2: 替换为 8 个 pills**

```html
<span class="status-pill" data-step="fetch">
  <span class="icon">○</span>
  <span class="label">获取信息</span>
</span>
<span class="status-pill" data-step="video">
  <span class="icon">○</span>
  <span class="label">视频下载</span>
</span>
<span class="status-pill" data-step="audio">
  <span class="icon">○</span>
  <span class="label">音频下载</span>
</span>
<span class="status-pill" data-step="subs">
  <span class="icon">○</span>
  <span class="label">字幕下载</span>
</span>
<span class="status-pill" data-step="vtt2md">
  <span class="icon">○</span>
  <span class="label">转换文案</span>
</span>
<span class="status-pill" data-step="md2vtt">
  <span class="icon">○</span>
  <span class="label">转寒字幕</span>
</span>
<span class="status-pill" data-step="article">
  <span class="icon">○</span>
  <span class="label">文章生产</span>
</span>
<span class="status-pill" data-step="summary">
  <span class="icon">○</span>
  <span class="label">提炼总结</span>
</span>
```

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "feat(frontend): update modal-status pills to 8 steps"
```

---

### Task 4: 更新 STEPS 数组

**Files:**
- Modify: `electron/src/renderer/index.html:1537`

**Step 1: 查看当前代码**

```javascript
const STEPS = ['info', 'video', 'audio', 'transcript', 'article', 'summary'];
```

**Step 2: 替换为 8 个 steps**

```javascript
const STEPS = ['fetch', 'video', 'audio', 'subs', 'vtt2md', 'md2vtt', 'article', 'summary'];
```

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "refactor(frontend): update STEPS array to 8 steps"
```

---

### Task 5: 更新状态解析逻辑 parseProgress

**Files:**
- Modify: `electron/src/renderer/index.html:2154-2209`

**Step 1: 查看当前代码 (约 2154-2188 行)**

```javascript
function parseProgress(text) {
  // Use standardized [STATUS] format for parsing
  const statusMatch = text.match(/\[STATUS\] (\S+)/);
  if (statusMatch) {
    const status = statusMatch[1];
    switch (status) {
      case 'info_start':
      case 'fetch_start':
      case 'info_done':
      case 'fetch_done':
        updateProgress('info');
        break;
      case 'video_start':
      case 'video_done':
        updateProgress('video');
        break;
      case 'audio_start':
      case 'audio_done':
        updateProgress('audio');
        break;
      case 'transcript_start':
      case 'transcript_done':
        updateProgress('transcript');
        break;
      case 'article_start':
      case 'article_done':
        updateProgress('article');
        break;
      case 'summary_start':
      case 'summary_done':
      case 'complete':
        updateProgress('summary');
        progressFill.style.width = '100%';
        break;
    }
    return;
  }
  // ... fallback 逻辑
}
```

**Step 2: 更新 switch case 添加新步骤**

```javascript
function parseProgress(text) {
  const statusMatch = text.match(/\[STATUS\] (\S+)/);
  if (statusMatch) {
    const status = statusMatch[1];
    switch (status) {
      case 'fetch_start':
      case 'fetch_done':
        updateProgress('fetch');
        break;
      case 'video_start':
      case 'video_done':
        updateProgress('video');
        break;
      case 'audio_start':
      case 'audio_done':
        updateProgress('audio');
        break;
      case 'subs_start':
      case 'subs_done':
        updateProgress('subs');
        break;
      case 'vtt2md_start':
      case 'vtt2md_done':
        updateProgress('vtt2md');
        break;
      case 'md2vtt_start':
      case 'md2vtt_done':
        updateProgress('md2vtt');
        break;
      case 'article_start':
      case 'article_done':
        updateProgress('article');
        break;
      case 'summary_start':
      case 'summary_done':
      case 'complete':
        updateProgress('summary');
        progressFill.style.width = '100%';
        break;
    }
    return;
  }
  // ... fallback 逻辑
}
```

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "feat(frontend): add parseProgress for subs/vtt2md/md2vtt steps"
```

---

### Task 6: 更新显示/隐藏逻辑

**Files:**
- Modify: `electron/src/renderer/index.html:1670-1700`

**Step 1: 查看当前代码**

```javascript
document.querySelectorAll('.modal-status .status-pill').forEach(el => {
  el.classList.add('hidden');
});

// 根据模式显示对应的 pills
if (mode === 'video' || mode === 'both') {
  document.querySelector('.modal-status .status-pill[data-step="info"]').classList.remove('hidden');
  document.querySelector('.modal-status .status-pill[data-step="video"]').classList.remove('hidden');
  document.querySelector('.modal-status .status-pill[data-step="audio"]').classList.remove('hidden');
}
if (mode === 'audio' || mode === 'both') {
  document.querySelector('.modal-status .status-pill[data-step="audio"]').classList.remove('hidden');
}
document.querySelector('.modal-status .status-pill[data-step="transcript"]').classList.remove('hidden');
document.querySelector('.modal-status .status-pill[data-step="article"]').classList.remove('hidden');
document.querySelector('.modal-status .status-pill[data-step="summary"]').classList.remove('hidden');
```

**Step 2: 更新为 8 个 pills**

```javascript
document.querySelectorAll('.modal-status .status-pill').forEach(el => {
  el.classList.add('hidden');
});

// fetch 始终显示
document.querySelector('.modal-status .status-pill[data-step="fetch"]').classList.remove('hidden');

// 根据模式显示对应的 pills
if (mode === 'video' || mode === 'both') {
  document.querySelector('.modal-status .status-pill[data-step="video"]').classList.remove('hidden');
}
if (mode === 'audio' || mode === 'both') {
  document.querySelector('.modal-status .status-pill[data-step="audio"]').classList.remove('hidden');
}

// subs 及后续步骤始终显示
document.querySelector('.modal-status .status-pill[data-step="subs"]').classList.remove('hidden');
document.querySelector('.modal-status .status-pill[data-step="vtt2md"]').classList.remove('hidden');
document.querySelector('.modal-status .status-pill[data-step="md2vtt"]').classList.remove('hidden');
document.querySelector('.modal-status .status-pill[data-step="article"]').classList.remove('hidden');
document.querySelector('.modal-status .status-pill[data-step="summary"]').classList.remove('hidden');
```

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "feat(frontend): update modal pill visibility for 8 steps"
```

---

### Task 7: 更新 updateInfoStatusPill 调用

**Files:**
- Modify: `electron/src/renderer/index.html:2114-2134` 及相关调用处

**Step 1: 搜索调用处**

```bash
grep -n "updateInfoStatusPill\|updateProgress" electron/src/renderer/index.html
```

**Step 2: 检查是否有使用 'info' 或 'transcript' 的调用**

需要确保所有调用都使用新的 step 名称：fetch, subs, vtt2md, md2vtt

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "fix(frontend): update status pill function calls"
```

---

### Task 8: 测试验证

**Step 1: 启动应用**

```bash
cd electron && npm start
```

**Step 2: 输入一个 YouTube URL 测试**

观察 8 个 pills 是否正确显示和更新：
- 获取信息 → 视频下载 → 音频下载 → 字幕下载 → 转换文案 → 转寒字幕 → 文章生产 → 提炼总结

**Step 3: 验证各状态**
- ○ 等待状态
- ◐ 进行中状态
- ● 完成状态

**Step 4: 提交**
```bash
git add .
git commit -m "test(frontend): verify 8-step status pills work correctly"
```

---

## 执行总结

| Task | 描述 | 预计改动行 |
|------|------|-----------|
| 1 | infoStatus pills | ~15 行 |
| 2 | progressSteps | ~10 行 |
| 3 | modal-status pills | ~15 行 |
| 4 | STEPS 数组 | 1 行 |
| 5 | parseProgress | ~15 行 |
| 6 | 显示/隐藏逻辑 | ~15 行 |
| 7 | 函数调用更新 | ~5 行 |
| 8 | 测试验证 | - |

**总改动约 80 行 HTML/JS**
