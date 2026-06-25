# Async Task Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make modal use task:status WebSocket messages + database query (same as main UI) for real-time status updates.

**Architecture:** Change run-pipeline IPC handler to return ID immediately without waiting for orchestrator.run() to complete. Frontend switches modal to edit mode immediately and receives status updates via WebSocket.

**Tech Stack:** Electron IPC, WebSocket, SQLite

---

## Task 1: Modify main.js to Return ID Immediately

**Files:**
- Modify: `electron/src/main.js:167-200`

**Step 1: Read current implementation**

Run: `grep -n "ipcMain.handle.*run-pipeline" electron/src/main.js`
Expected: Line 167

**Step 2: Modify run-pipeline handler to be async**

Replace the current `ipcMain.handle('run-pipeline')` implementation (lines 167-200) with:

```javascript
ipcMain.handle('run-pipeline', async (event, { url, focus, force, downloadVideo, id }) => {
  try {
    console.log('[DEBUG] run-pipeline called with:', { url, focus, force, downloadVideo, id });

    // 确定是否下载视频
    let shouldDownloadVideo = false;
    let shouldDownloadAudio = false;
    if (downloadVideo === 'video') {
      shouldDownloadVideo = true;
    } else if (downloadVideo === 'audio') {
      shouldDownloadAudio = true;
    }
    console.log('[DEBUG] resolved download options:', { shouldDownloadVideo, shouldDownloadAudio });

    // 立即生成 task ID 并返回，让前端可以立即更新 UI
    const taskId = orchestrator.generateId(url);
    console.log('[DEBUG] generated task ID:', taskId);

    // 在后台启动任务执行（不等待完成）
    orchestrator.run(url, {
      downloadVideo: shouldDownloadVideo,
      downloadAudio: shouldDownloadAudio,
      focus,
      force: force || false,
      output_lang: 'zh-CN'
    }).then(result => {
      // 任务完成后广播 task:complete 消息
      console.log('[DEBUG] background task completed:', result.id);
      if (wsServer) {
        wsServer.broadcast('task:complete', { id: result.id, success: true });
      }
      // 更新数据库中的任务完成状态
      if (db) {
        db.updateStep(result.id, 'summary', 'completed');
        db.updateDownload(result.id, 'completed');
      }
    }).catch(err => {
      console.error('[DEBUG] background task error:', err);
      if (wsServer) {
        wsServer.broadcast('task:error', { id: taskId, error: err.message });
      }
    });

    // 立即返回 ID 给前端
    return { success: true, id: taskId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
```

**Step 3: Verify no syntax errors**

Run: `cd electron && node -c src/main.js`
Expected: No output (success)

**Step 4: Commit**

```bash
git add electron/src/main.js
git commit -m "feat: return task ID immediately without waiting for execution"
```

---

## Task 2: Add modalTaskId Variable and Switch to Edit Mode

**Files:**
- Modify: `electron/src/renderer/index.html:1755`

**Step 1: Add modalTaskId variable**

Find line 1755 (or near it) which has `let currentResetTaskId = null;`

Add after it:
```javascript
let modalTaskId = null;
```

**Step 2: Modify runPipeline response handling**

Find lines 1974-1983 where `res.success` is handled:
```javascript
if (res.success) {
  const newId = res.id;
  if (newId) {
    // Close modal and load the new task
    closeNewTaskModal();
    await loadWork(newId);
    await loadHistory();
    // Auto-open manage modal for the new task
    await openManageModal();
  }
}
```

Replace with:
```javascript
if (res.success) {
  const newId = res.id;
  if (newId) {
    // 设置 modalTaskId 用于后续状态更新
    modalTaskId = newId;
    // 切换弹窗到编辑模式
    newTaskModal.setAttribute('data-mode', 'edit');
    modalTitle.textContent = 'Manage Task';
    modalRunBtn.textContent = '继续执行';
    modalSaveBtn.classList.remove('hidden');
    // 不关闭弹窗，保持打开状态
    // 状态将通过 WebSocket task:status 更新
    console.log('[DEBUG] modalTaskId set to:', modalTaskId);
  }
}
```

**Step 3: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: set modalTaskId after getting response, switch to edit mode"
```

---

## Task 3: Update Modal Status from task:status WebSocket Messages

**Files:**
- Modify: `electron/src/renderer/index.html:2353-2355` (case 'task:status')

**Step 1: Find task:status handler**

Run: `grep -n "case 'task:status'" electron/src/renderer/index.html`
Expected: Around line 2353

**Step 2: Modify to update modal status**

Find the task:status case and add modal update logic:

```javascript
case 'task:status':
    updateTaskStatus(data.payload);
    // 如果弹窗打开且任务匹配，更新弹窗状态
    if (modalTaskId && data.payload.id === modalTaskId && newTaskModal.classList.contains('hidden') === false) {
        console.log('[DEBUG] updating modal status for:', modalTaskId);
        loadWork(modalTaskId);
    }
    break;
```

**Step 3: Also update on task:complete**

Find `case 'task:complete'` and add similar logic:
```javascript
case 'task:complete':
    handleTaskComplete(data.payload);
    if (modalTaskId && data.payload.id === modalTaskId) {
        console.log('[DEBUG] task complete for modal:', modalTaskId);
    }
    break;
```

**Step 4: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: update modal status from task:status WebSocket messages"
```

---

## Task 4: Test New Task Mode

**Step 1: Start Electron**

Run: `cd /Users/harveyzhang96/Projects/Video-Learner/.worktrees/fix-realtime-status-pills && bash start-electron.sh`

**Step 2: Test new task flow**

1. Click "New Task" button to open modal
2. Enter a YouTube URL
3. Click "Run"
4. **Expected:**
   - Modal should NOT close immediately
   - Modal should switch to "Manage Task" mode (edit mode)
   - Status pills should update in real-time as the task progresses
   - When task completes, status should show completed

**Step 3: Verify debug output**

Check terminal for:
- `[DEBUG] generated task ID: xxx`
- `[DEBUG] modalTaskId set to: xxx`
- `[DEBUG] updating modal status for: xxx`

---

## Task 5: Test Edit Mode (Continue Task)

**Step 1: Select an existing task from history**

Click on a task in the history list

**Step 2: Click "继续执行"**

**Expected:**
- Status pills should update in real-time

---

## Verification Checklist

- [ ] New task: Modal stays open after clicking Run
- [ ] New task: Modal switches to edit mode (shows "Manage Task")
- [ ] New task: Status pills update in real-time
- [ ] New task: Task completes and shows completed status
- [ ] Edit mode: Status pills update in real-time
- [ ] Main UI: Status pills still update correctly (no regression)
