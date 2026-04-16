# 修复实时 Status Pills 状态更新

## 问题

前端 Tag Pills 没有正确更新状态，部分成功。

**原因分析：**
1. **进度条不更新**: `appendOutput()` 没有调用 `parseProgress()` 解析日志中的 `[STATUS]`
2. **Status Pills 实时更新不生效**: `task:status` 事件触发 `loadWork()`，但实时更新时只是重新加载任务数据，没有直接更新 pills UI

## 方案：使用 step_status 更新（方案二）

从 Orchestrator 推送的 `task:status` 事件中获取 `steps` 对象，直接更新 Status Pills。

## 数据流

```
Orchestrator 推送
  ↓
task:status 事件 { id, currentStep, stepStatus, steps }
  ↓
updateTaskStatus(payload)
  ↓
直接更新 pills UI + 进度条
```

## 修改内容

### 1. 修改 updateTaskStatus 函数

```javascript
function updateTaskStatus(status) {
    // 更新进度条
    if (status.currentStep) {
        updateProgress(status.currentStep);
    }

    // 直接更新 Status Pills
    if (status.steps) {
        Object.keys(status.steps).forEach(step => {
            const stepState = status.steps[step];
            let uiState = 'pending';
            if (stepState === 'running') uiState = 'active';
            else if (stepState === 'completed') uiState = 'done';
            else if (stepState === 'failed') uiState = 'error';

            updateInfoStatusPill(step, uiState);
        });
    }

    // 如果需要刷新历史
    loadHistory();
}
```

### 2. （可选）添加 parseProgress 调用

如果想保留日志解析作为备用方案，可以在 appendOutput 中添加：

```javascript
function appendOutput(text) {
    // ... 现有代码 ...
    parseProgress(text);  // 添加这行
}
```

## 修改文件

- `electron/src/renderer/index.html`
  - 修改 `updateTaskStatus` 函数 (约 2334-2339 行)
