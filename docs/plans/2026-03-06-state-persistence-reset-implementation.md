# 弹窗状态感知与重置功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现弹窗状态持久化和重置功能 - localStorage 缓存 + tag pill 点击重置

**Architecture:** 前端 localStorage 缓存 + 后端 meta.json 持久化 + IPC 通信

**Tech Stack:** HTML/CSS/JavaScript (Electron), Shell (run.sh)

---

## 修改概览

| 文件 | 修改内容 |
|------|----------|
| `electron/src/renderer/index.html` | 添加 localStorage 逻辑、重置弹窗 UI、tag pill 点击事件 |
| `electron/src/main.js` | 添加重置状态的 IPC 处理器 |
| `electron/src/preload.js` | 暴露新的 API 给前端 |

---

## Task 1: 添加 localStorage 辅助函数

**Files:**
- Modify: `electron/src/renderer/index.html` (在 `<script>` 开头添加)

**Step 1: 添加 localStorage 辅助函数**

在 `<script>` 标签开头（约第 1300 行）添加：

```javascript
// === localStorage 辅助函数 ===
const LS_KEYS = {
    PREFERENCES: 'video_learner_preferences',
    TASK_CACHE: (id) => `video_learner_task_${id}`
};

function savePreferences(prefs) {
    localStorage.setItem(LS_KEYS.PREFERENCES, JSON.stringify(prefs));
}

function loadPreferences() {
    const data = localStorage.getItem(LS_KEYS.PREFERENCES);
    return data ? JSON.parse(data) : { defaultFocus: '', defaultDownloadMode: 'video' };
}

function saveTaskCache(id, taskData) {
    localStorage.setItem(LS_KEYS.TASK_CACHE(id), JSON.stringify(taskData));
}

function loadTaskCache(id) {
    const data = localStorage.getItem(LS_KEYS.TASK_CACHE(id));
    return data ? JSON.parse(data) : null;
}

function clearTaskCache(id) {
    localStorage.removeItem(LS_KEYS.TASK_CACHE(id));
}
```

**Step 2: 验证语法**

打开浏览器控制台检查无报错

**Step 3: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: add localStorage helper functions"
```

---

## Task 2: 修改弹窗打开逻辑，优先读取 localStorage

**Files:**
- Modify: `electron/src/renderer/index.html` (约 1341-1375 行)

**Step 1: 修改 openManageTaskModal 函数**

在 `openManageTaskModal` 函数中，读取 meta.json 后，同时写入 localStorage 缓存：

```javascript
// 原代码（约 1363 行）
const meta = await window.api.readFile(`work/${currentId}/transcript/meta.json`);
const j = JSON.parse(meta);

// 在解析 j 后添加缓存：
if (j) {
    saveTaskCache(currentId, {
        download_status: j.download_status,
        transcript_done: j.transcript_done,
        article_done: j.article_done,
        summary_done: j.summary_done,
        focus: j.focus,
        title: j.title
    });
}
```

**Step 2: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: cache task state to localStorage when opening modal"
```

---

## Task 3: 添加重置弹窗 UI

**Files:**
- Modify: `electron/src/renderer/index.html` (在 modal-status 后添加)

**Step 1: 添加重置弹窗 HTML**

在 `</div><!-- modal-status -->` 后（约 1273 行）添加：

```html
<!-- 重置确认弹窗 -->
<div class="reset-popup hidden" id="resetPopup">
    <div class="reset-popup-content">
        <div class="reset-popup-header">
            <span class="reset-popup-title">重置步骤</span>
            <button class="reset-popup-close" id="resetPopupClose">&times;</button>
        </div>
        <div class="reset-popup-body">
            <p>确定要重置 <strong id="resetStepName"></strong> 吗？</p>
            <p class="reset-popup-hint">重置后将可以重新执行此步骤</p>
        </div>
        <div class="reset-popup-actions">
            <button class="btn" id="resetPopupCancel">取消</button>
            <button class="btn danger" id="resetPopupConfirm">重置</button>
        </div>
    </div>
</div>
```

**Step 2: 添加重置弹窗 CSS**

在 `.modal-status` 样式后添加：

```css
/* 重置弹窗 */
.reset-popup {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
}
.reset-popup.hidden { display: none; }
.reset-popup-content {
    background: #1e1e1e;
    border-radius: 8px;
    padding: 20px;
    min-width: 300px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}
.reset-popup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}
.reset-popup-title { font-size: 16px; font-weight: 600; }
.reset-popup-close {
    background: none;
    border: none;
    color: #888;
    font-size: 24px;
    cursor: pointer;
}
.reset-popup-body { margin-bottom: 20px; }
.reset-popup-hint { color: #888; font-size: 12px; margin-top: 8px; }
.reset-popup-actions { display: flex; gap: 10px; justify-content: flex-end; }
.btn.danger { background: #d32f2f; color: white; }
.btn.danger:hover { background: #b71c1c; }
```

**Step 3: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: add reset popup UI"
```

---

## Task 4: 添加 tag pill 点击事件和重置逻辑

**Files:**
- Modify: `electron/src/renderer/index.html` (在 setModalStep 函数后添加)

**Step 1: 添加重置弹窗变量和事件监听**

在 `setModalStep` 函数后添加：

```javascript
// === 重置弹窗逻辑 ===
const resetPopup = document.getElementById('resetPopup');
const resetPopupClose = document.getElementById('resetPopupClose');
const resetPopupCancel = document.getElementById('resetPopupCancel');
const resetPopupConfirm = document.getElementById('resetPopupConfirm');
const resetStepName = document.getElementById('resetStepName');

let currentResetStep = null;
let currentResetTaskId = null;

// 点击已完成步骤的 tag pill 时显示重置弹窗
document.querySelectorAll('.modal-status .status-pill.done').forEach(pill => {
    pill.style.cursor = 'pointer';
    pill.addEventListener('click', () => {
        const step = pill.dataset.step;
        if (step === 'info' || step === 'audio') return; // info 和 audio 不可重置
        currentResetStep = step;
        currentResetTaskId = currentId;
        resetStepName.textContent = {
            video: '视频下载',
            transcript: '转录',
            article: '文章',
            summary: '总结'
        [step];
        resetPopup.classList.remove('hidden');
    });
});

// 关闭弹窗
resetPopupClose.addEventListener('click', () => resetPopup.classList.add('hidden'));
resetPopupCancel.addEventListener('click', () => resetPopup.classList.add('hidden'));
resetPopup.addEventListener('click', (e) => {
    if (e.target === resetPopup) resetPopup.classList.add('hidden');
});

// 确认重置
resetPopupConfirm.addEventListener('click', async () => {
    if (!currentResetStep || !currentResetTaskId) return;

    try {
        await window.api.resetTaskStep(currentResetTaskId, currentResetStep);

        // 更新 UI
        setModalStep(currentResetStep, 'pending');

        // 清除缓存
        clearTaskCache(currentResetTaskId);

        resetPopup.classList.add('hidden');
    } catch (e) {
        alert('重置失败: ' + e.message);
    }
});
```

**Step 2: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: add tag pill click handler and reset logic"
```

---

## Task 5: 添加 preload.js API

**Files:**
- Modify: `electron/src/preload.js`

**Step 1: 添加 resetTaskStep API**

在 `contextBridge.exposeInMainWorld` 中添加：

```javascript
resetTaskStep: (id, step) => ipcRenderer.invoke('reset-task-step', { id, step })
```

**Step 2: Commit**

```bash
git add electron/src/preload.js
git commit -m "feat: expose resetTaskStep API to renderer"
```

---

## Task 6: 添加 main.js IPC 处理器

**Files:**
- Modify: `electron/src/main.js`

**Step 1: 添加 reset-task-step 处理器**

在 IPC handlers 区域末尾添加：

```javascript
ipcMain.handle('reset-task-step', async (event, { id, step }) => {
    const metaPath = path.join(__dirname, '../..', 'work', id, 'transcript', 'meta.json');
    const fs = require('fs');

    if (!fs.existsSync(metaPath)) {
        throw new Error('任务不存在');
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

    // 根据步骤更新状态
    switch (step) {
        case 'video':
            meta.download_status = 'pending';
            meta.download_attempts = 0;
            break;
        case 'transcript':
            meta.transcript_done = false;
            break;
        case 'article':
            meta.article_done = false;
            break;
        case 'summary':
            meta.summary_done = false;
            break;
        default:
            throw new Error('未知步骤: ' + step);
    }

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return { success: true };
});
```

**Step 2: 验证语法**

```bash
node -c electron/src/main.js
```

**Step 3: Commit**

```bash
git add electron/src/main.js
git commit -m "feat: add reset-task-step IPC handler"
```

---

## 验证步骤

1. **启动应用**：
   ```bash
   bash start-electron.sh
   ```

2. **测试状态缓存**：
   - 打开一个已有任务
   - 关闭后检查 localStorage 是否有 `video_learner_task_<id>` 数据

3. **测试重置功能**：
   - 打开已完成的任务弹窗
   - 点击"转录"或"文章"等已完成步骤的 tag pill
   - 验证弹出重置弹窗
   - 点击"重置"，验证状态回退到 pending

4. **验证未完成步骤不可点击**：
   - 未完成步骤的 tag pill 点击无反应

---

## 执行选项

**Plan complete and saved to `docs/plans/2026-03-06-state-persistence-reset-implementation.md`. Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
