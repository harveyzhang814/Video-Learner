# MODE 设计实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现新的 MODE 命名系统，支持全流程（full_flow_*）和独立环节两种模式

**Architecture:** 修改 run.sh 的辅助函数逻辑，更新 main.js 的前端映射，保持向后兼容

**Tech Stack:** Shell (run.sh), Electron (main.js)

---

## 修改概览

| 文件 | 修改内容 |
|------|----------|
| `scripts/run.sh` | 更新 MODE 默认值和辅助函数 |
| `electron/src/main.js` | 更新前端到 MODE 的映射 |

---

## Task 1: 修改 run.sh MODE 默认值

**Files:**
- Modify: `scripts/run.sh:12`

**Step 1: 修改默认 MODE**

将第 12 行从：
```bash
MODE="both"
```

改为：
```bash
MODE="full_flow_video"
```

**Step 2: 验证修改**

检查文件确认修改正确

**Step 3: Commit**

```bash
git add scripts/run.sh
git commit -m "feat: change default MODE to full_flow_video"
```

---

## Task 2: 修改 run.sh 辅助函数

**Files:**
- Modify: `scripts/run.sh:159-166`

**Step 1: 替换辅助函数**

将第 159-166 行：
```bash
mode_has_video() {
    echo "$MODE" | grep -qE "(both|video)" && return 0 || return 1
}
mode_has_audio() {
    echo "$MODE" | grep -qE "(both|audio)" && return 0 || return 1
}
mode_has_transcript() {
    echo "$MODE" | grep -qE "(both|transcript)" && return 0 || return 1
}
```

替换为：
```bash
mode_has_video() {
    [[ "$MODE" == "full_flow_video" ]] || [[ "$MODE" == "download_video" ]]
}

mode_has_audio() {
    [[ "$MODE" == "full_flow_audio" ]] || [[ "$MODE" == "download_audio" ]]
}

mode_has_transcript() {
    [[ "$MODE" == "get_transcript" ]] || [[ "$MODE" == full_flow_* ]]
}

mode_has_article() {
    [[ "$MODE" == "write_article" ]] || [[ "$MODE" == full_flow_video ]] || [[ "$MODE" == "full_flow_audio" ]]
}

mode_has_summary() {
    [[ "$MODE" == "summarize" ]] || [[ "$MODE" == full_flow_video ]] || [[ "$MODE" == "full_flow_audio" ]]
}
```

**Step 2: 验证语法**

```bash
bash -n scripts/run.sh
```

**Step 3: Commit**

```bash
git add scripts/run.sh
git commit -m "feat: update mode helper functions for new naming"
```

---

## Task 3: 更新 run.sh 文档注释

**Files:**
- Modify: `scripts/run.sh:3`, `scripts/run.sh:47`

**Step 1: 更新 Usage 注释**

第 3 行改为：
```bash
# Usage: bash scripts/run.sh "<URL>" [LANG=auto] [MODE=full_flow_video|full_flow_audio|full_flow_transcript|download_video|download_audio|get_transcript|write_article|summarize] [FORCE=0|1] [FOCUS="..."]
```

第 47 行改为：
```bash
    echo "Usage: bash scripts/run.sh \"<URL>\" [LANG=auto] [MODE=full_flow_video|full_flow_audio|full_flow_transcript|download_video|download_audio|get_transcript|write_article|summarize] [FORCE=0|1] [FOCUS=\"...\"]"
```

**Step 2: Commit**

```bash
git add scripts/run.sh
git commit -m "docs: update MODE usage documentation"
```

---

## Task 4: 修改 main.js 前端映射

**Files:**
- Modify: `electron/src/main.js:32-45`

**Step 1: 更新 MODE 映射逻辑**

将第 34 行从：
```javascript
const mode = downloadVideo ? 'both' : 'transcript';
```

改为：
```javascript
let mode;
if (downloadVideo === 'video') {
    mode = 'full_flow_video';
} else if (downloadVideo === 'audio') {
    mode = 'full_flow_audio';
} else {
    mode = 'full_flow_transcript';
}
```

**Step 2: 验证语法**

```bash
node -c electron/src/main.js
```

**Step 3: Commit**

```bash
git add electron/src/main.js
git commit -m "feat: update frontend-to-mode mapping"
```

---

## Task 5: 更新 main.js API 文档注释

**Files:**
- Modify: `electron/src/main.js:32` (添加注释)

**Step 1: 添加 JSDoc 注释**

在第 32 行上方添加：
```javascript
/**
 * downloadVideo 参数说明:
 * - 'video': 下载视频 (MODE=full_flow_video)
 * - 'audio': 下载音频 (MODE=full_flow_audio)
 * - 其他: 不下载媒体 (MODE=full_flow_transcript)
 */
```

**Step 2: Commit**

```bash
git add electron/src/main.js
git commit -m "docs: add downloadVideo parameter documentation"
```

---

## 验证步骤

1. **测试 full_flow_video 模式**:
   ```bash
   bash scripts/run.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" MODE=full_flow_video FORCE=1
   ```
   预期：下载 video.mp4 + 转录 + 文章 + 总结，无 audio.m4a

2. **测试 full_flow_audio 模式**:
   ```bash
   bash scripts/run.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" MODE=full_flow_audio FORCE=1
   ```
   预期：下载 audio.m4a + 转录 + 文章 + 总结

3. **测试 full_flow_transcript 模式**:
   ```bash
   bash scripts/run.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" MODE=full_flow_transcript FORCE=1
   ```
   预期：仅转录+文章+总结，无媒体文件

4. **测试独立环节模式**:
   ```bash
   bash scripts/run.sh "ID=xxx" MODE=download_video
   ```
   预期：仅下载视频

---

## 执行选项

**Plan complete and saved to `docs/plans/2026-03-05-mode-implementation.md`. Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
