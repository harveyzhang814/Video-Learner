# 使用 step_status 统一更新 Status Pills 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 简化 Status Pills 状态更新逻辑，直接使用 `step_status` 对象替代废弃字段

**Architecture:** 修改 `loadWork()` 函数，遍历 8 个 steps 直接从 `step_status` 读取状态并更新 UI

**Tech Stack:** Vanilla JavaScript, HTML

---

## 准备

检查当前分支：
```bash
git branch
```

如果不在 feature 分支，创建新分支：
```bash
git checkout -b feature/step-status-pills
```

---

## 任务清单

### Task 1: 创建 step 状态映射函数

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 找到 loadWork 函数中更新 pills 的代码**

约在 2439-2452 行：
```javascript
// Update status pills based on database
resetInfoStatusPills();
if (j.download_status === 'success') {
  updateInfoStatusPill('video', 'done');
} else if (j.download_status === 'failed') {
  updateInfoStatusPill('video', 'error');
}
if (j.transcript_done) {
  updateInfoStatusPill('subs', 'done');
}
if (j.article_done) {
  updateInfoStatusPill('article', 'done');
}
if (j.summary_done) {
  updateInfoStatusPill('summary', 'done');
} else if (j.step_status && (j.step_status.summary === 'pending' || j.step_status.summary === 'running')) {
  updateInfoStatusPill('summary', 'active');
}
```

**Step 2: 替换为新的映射逻辑**

```javascript
// Update status pills based on step_status
resetInfoStatusPills();
const stepStatus = j.step_status || {};

// 状态映射函数
function mapStepStatusToUI(status) {
  switch (status) {
    case 'running': return 'active';
    case 'completed': return 'done';
    case 'failed': return 'error';
    default: return 'pending';
  }
}

// 更新所有 8 个 steps
const steps = ['fetch', 'video', 'audio', 'subs', 'vtt2md', 'md2vtt', 'article', 'summary'];
steps.forEach(step => {
  const status = stepStatus[step] || 'pending';
  const uiState = mapStepStatusToUI(status);
  updateInfoStatusPill(step, uiState);
});
```

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "refactor(frontend): use step_status for status pills"
```

---

### Task 2: 验证实时更新机制

**Step 1: 检查 WebSocket 消息处理**

验证 `task:status` 事件是否正确处理。查看代码（约 2317-2339 行）:

```javascript
function handleWsMessage(data) {
    switch (data.type) {
        case 'task:status':
            updateTaskStatus(data.payload);  // 会调用 loadWork()
            break;
```

**Step 2: 确认 loadWork 被调用时会更新 pills**

`updateTaskStatus` 调用 `loadWork()`，而 `loadWork()` 现在使用 `step_status` 更新 pills。

**Step 3: 测试验证**

启动应用，运行一个任务，观察进度条和 pills 的实时更新。

**Step 4: 提交**
```bash
git add .
git commit -m "test(frontend): verify step_status updates status pills"
```

---

## 验证方式

1. 启动 Electron 应用
2. 选择或创建一个任务
3. 观察 8 个 pills 的状态是否正确：
   - fetch → video → audio → subs → vtt2md → md2vtt → article → summary
4. 运行新任务时观察实时更新

## 执行总结

| Task | 描述 | 预计改动 |
|------|------|----------|
| 1 | 创建状态映射函数 | ~20 行 |
| 2 | 验证实时更新 | 代码审查 |
