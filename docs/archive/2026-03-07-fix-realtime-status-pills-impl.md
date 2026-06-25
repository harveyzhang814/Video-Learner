# 修复实时 Status Pills 状态更新实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复前端 Status Pills 实时状态不更新的问题，使用 step_status 直接更新 UI

**Architecture:** 修改 `updateTaskStatus` 函数，从 `task:status` 事件的 `steps` 对象直接更新 Status Pills

**Tech Stack:** Vanilla JavaScript, HTML

---

## 准备

```bash
git branch
```

如果不在 feature 分支，创建新分支：
```bash
git checkout -b fix/realtime-status-pills
```

---

## 任务清单

### Task 1: 修改 updateTaskStatus 函数

**Files:**
- Modify: `electron/src/renderer/index.html:2334-2339`

**Step 1: 查看当前代码**

```javascript
function updateTaskStatus(status) {
    if (status.id === currentId) {
        loadWork(status.id);
    }
    loadHistory();
}
```

**Step 2: 替换为新逻辑**

```javascript
function updateTaskStatus(payload) {
    // 更新进度条
    if (payload.currentStep) {
        updateProgress(payload.currentStep);
    }

    // 直接更新 Status Pills
    if (payload.steps) {
        Object.keys(payload.steps).forEach(step => {
            const stepState = payload.steps[step];
            let uiState = 'pending';
            if (stepState === 'running') uiState = 'active';
            else if (stepState === 'completed') uiState = 'done';
            else if (stepState === 'failed') uiState = 'error';

            updateInfoStatusPill(step, uiState);
        });
    }

    loadHistory();
}
```

**Step 3: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "fix(frontend): update status pills in real-time from task:status event"
```

---

### Task 2: 添加 parseProgress 到 appendOutput（可选备用）

**Files:**
- Modify: `electron/src/renderer/index.html:2361-2374`

**Step 1: 在 appendOutput 中添加 parseProgress 调用**

在 `modalLogs.appendChild(div)` 之后添加：
```javascript
parseProgress(line);
```

**Step 2: 提交**
```bash
git add electron/src/renderer/index.html
git commit -m "feat(frontend): parse progress from log output as fallback"
```

---

## 验证方式

1. 启动 Electron 应用
2. 运行一个任务
3. 观察 Status Pills 实时更新：
   - ○ → ◐ (running) → ● (completed)
   - ✕ (failed)
