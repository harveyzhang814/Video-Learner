# 使用 step_status 统一更新 Status Pills

## 目标

简化 Status Pills 的状态更新逻辑，直接使用 `step_status` 对象替代已废弃的 `download_status`, `transcript_done`, `article_done`, `summary_done` 字段。

## 当前问题

### 1. loadWork() 中的状态更新 (index.html:2439-2452)
```javascript
// 使用废弃字段推断状态
if (j.download_status === 'success') {
  updateInfoStatusPill('video', 'done');
}
if (j.transcript_done) {  // 实际是 stepStatus.subs === 'completed' 的推断
  updateInfoStatusPill('subs', 'done');
}
```

### 2. API 返回的冗余字段 (main.js:334-337)
```javascript
step_status: stepStatus,        // 真实的 step 状态
transcript_done: stepStatus.subs === 'completed',  // 冗余推断
article_done: stepStatus.article === 'completed',   // 冗余推断
summary_done: stepStatus.summary === 'completed'    // 冗余推断
```

## 修改方案

### 1. Frontend: loadWork() 直接使用 step_status

```javascript
function updateInfoStatusPillFromStepStatus(stepStatus) {
  const stepMap = {
    'fetch': 'fetch',
    'video': 'video',
    'audio': 'audio',
    'subs': 'subs',
    'vtt2md': 'vtt2md',
    'md2vtt': 'md2vtt',
    'article': 'article',
    'summary': 'summary'
  };

  Object.keys(stepMap).forEach(step => {
    const status = stepStatus[step] || 'pending';
    let uiState = 'pending';
    if (status === 'running') uiState = 'active';
    else if (status === 'completed') uiState = 'done';
    else if (status === 'failed') uiState = 'error';

    updateInfoStatusPill(step, uiState);
  });
}
```

### 2. Backend: 移除冗余字段 (可选)

API 可以选择保留旧字段保持向后兼容，或直接移除。

## UI 状态映射

| step_status | UI State |
|-------------|----------|
| pending | ○ (pending) |
| running | ◐ (active) |
| completed | ● (done) |
| failed | ✕ (error) |
| skipped | ○ (pending) |

## 修改文件

- `electron/src/renderer/index.html` - 修改 `loadWork()` 函数中的状态更新逻辑

## 验证方式

1. 启动应用
2. 选择一个历史任务
3. 验证所有 8 个 pills 的状态正确显示
