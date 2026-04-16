# 任务创建与实时状态推送实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现任务创建后立即推送到前端，fetch 完成后更新任务信息，Run 成功后自动打开 Manage 弹窗

**Architecture:** 后端在 saveMeta 后推送 task-created 事件，在 fetch 完成后推送 task-updated 事件。前端监听这些事件并刷新列表。Run 成功后自动打开 Manage 弹窗。

**Tech Stack:** Electron, IPC, JavaScript

---

## Task 1: 添加 preload.js 任务事件监听 API

**Files:**
- Modify: `electron/src/preload.js:22-25`

**Step 1: 添加 onTaskCreated 和 onTaskUpdated 监听 API**

在 `onOutput` 后添加两个新的事件监听方法：

```javascript
onOutput: (callback) => {
  ipcRenderer.on('pipeline-output', (event, text) => callback(text));
},
onTaskCreated: (callback) => {
  ipcRenderer.on('task-created', (event, task) => callback(task));
},
onTaskUpdated: (callback) => {
  ipcRenderer.on('task-updated', (event, task) => callback(task));
}
```

**Step 2: 提交**

```bash
git add electron/src/preload.js
git commit -m "feat: add task event listener APIs in preload"
```

---

## Task 2: 修改 main.js 在 saveMeta 后推送 task-created

**Files:**
- Modify: `electron/src/main.js:72-79` (在 orchestrator.run() 调用后)

**Step 1: 在 run-pipeline 处理中添加 task-created 推送**

找到 `orchestrator.run()` 调用的位置，在成功后推送事件：

```javascript
// 使用编排层执行
const result = await orchestrator.run(url, {
  downloadVideo: shouldDownloadVideo,
  downloadAudio: shouldDownloadAudio,
  focus,
  force: force || false,
  output_lang: 'zh-CN'
});

// 任务开始后立即推送 task-created 事件
if (mainWindow && !mainWindow.isDestroyed()) {
  mainWindow.webContents.send('task-created', {
    id: result.id,
    url: url,
    ts: new Date().toISOString()
  });
}
```

**Step 2: 提交**

```bash
git add electron/src/main.js
git commit -m "feat: push task-created event after orchestrator.run"
```

---

## Task 3: 修改 orchestrator 在 fetch 完成后推送 task-updated

**Files:**
- Modify: `electron/src/orchestrator.js:282-285`

**Step 1: 添加回调函数参数**

在 Orchestrator 构造函数中添加可选的回调函数：

```javascript
constructor(baseDir, onOutput = null, onTaskUpdated = null) {
  this.baseDir = baseDir;
  this.onOutput = onOutput;
  this.onTaskUpdated = onTaskUpdated;
}
```

添加设置回调的方法：

```javascript
setTaskUpdatedCallback(callback) {
  this.onTaskUpdated = callback;
}
```

**Step 2: 在 runStep('fetch') 完成后推送事件**

在 run() 方法的 fetch 步骤完成后添加推送：

```javascript
// Step 0: 获取视频元信息
await this.runStep(id, 'fetch');

// fetch 完成后推送 task-updated 事件
if (this.onTaskUpdated) {
  const meta = this.getMeta(id);
  this.onTaskUpdated(meta);
}
```

**Step 3: 修改 main.js 传递回调**

```javascript
orchestrator = new Orchestrator(baseDir, (text) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pipeline-output', text);
  }
}, (task) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task-updated', task);
  }
});
```

**Step 4: 提交**

```bash
git add electron/src/orchestrator.js electron/src/main.js
git commit -m "feat: push task-updated event after fetch step completes"
```

---

## Task 4: 修改 index.html 监听任务事件

**Files:**
- Modify: `electron/src/renderer/index.html:1656-1658` (在 loadHistory 调用附近)
- Modify: `electron/src/renderer/index.html:1926-1950` (Run 按钮逻辑)

**Step 1: 在页面加载时注册任务事件监听**

在 `loadHistory()` 调用后添加：

```javascript
loadHistory();

// 监听任务创建事件 - 立即刷新列表
window.api.onTaskCreated((task) => {
  loadHistory();
});

// 监听任务更新事件 - 更新任务信息
window.api.onTaskUpdated((task) => {
  // 如果当前查看的是这个任务，更新显示
  if (task.id === currentId) {
    loadWork(task.id);
  }
  // 刷新列表以更新标题
  loadHistory();
});
```

**Step 2: 修改 Run 按钮成功后的行为**

在 `runNewTask` 函数中，找到 `if (res.success)` 块，修改为：

```javascript
if (res.success) {
  const m = res.output.match(/ID: ([a-f0-9]+)/);
  if (m) {
    const newId = m[1];
    // 关闭弹窗
    closeNewTaskModal();
    // 自动打开 Manage 弹窗
    currentId = newId;
    await loadWork(newId);
    await openManageModal();
  }
}
```

**Step 3: 提交**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: listen to task events and auto-open manage modal"
```

---

## Task 5: 映射 info 状态到 fetch

**Files:**
- Modify: `electron/src/renderer/index.html:1841-1848` (parseProgress switch)

**Step 1: 将 info_start/info_done 映射到 fetch**

```javascript
switch (status) {
  case 'info_start':
  case 'fetch_start':
    setModalStep('info', 'active');
    break;
  case 'info_done':
  case 'fetch_done':
    setModalStep('info', 'done');
    break;
```

**Step 2: 同样更新主界面的 parseProgress 函数**

在 `parseProgress` 函数中添加相同的映射。

**Step 3: 提交**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: map info status to fetch step"
```

---

## Task 6: 测试完整流程

**Step 1: 启动 Electron 应用**

```bash
cd electron && npm start
```

**Step 2: 测试流程**
1. 打开应用，点击 "New Task" 按钮
2. 输入 YouTube URL，点击 Run
3. 验证：任务立即出现在左侧列表
4. 验证：fetch 完成后标题更新
5. 验证：弹窗关闭，Manage 弹窗打开，显示实时 log

**Step 3: 提交**

```bash
git commit -m "test: verify task creation flow"
```

---

## 预期效果

1. 用户点击 Run → 任务立即出现在左侧列表（无标题）
2. fetch 完成后 → 任务标题更新
3. Manage 弹窗自动打开，显示实时 log 和状态
4. 用户可随时点击任务查看进度
