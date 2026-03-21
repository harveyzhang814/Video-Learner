# 任务创建与实时状态推送设计

## 目标

优化用户体验：
1. 点击创建弹窗的 Run → 任务立即出现在列表 → 弹窗关闭
2. 用户打开任务 → 主界面 tagpill 显示状态
3. 点击 manage → 显示实时刷新的状态和 log

## 架构

```
用户点击 Run
     │
     ▼
后端 orchestrator.run()
     │
     ├─► saveMeta() ──────► IPC: 'task-created' ──► 前端 loadHistory()
     │                                         │
     │                                         ▼
     │                                   列表出现任务（title为空）
     │
     └─► runStep('fetch')
           │
           └─► fetch 完成 ──► IPC: 'task-updated' ──► 前端刷新该任务信息
                                                      │
                                                      ▼
                                                标题等更新
```

## 前端改动

### 1. preload.js - 添加事件监听 API

```javascript
// 监听任务创建事件
ipcRenderer.on('task-created', (event, task) => {
  // 刷新任务列表
});

// 监听任务更新事件
ipcRenderer.on('task-updated', (event, task) => {
  // 更新任务信息
});
```

### 2. index.html - 前端逻辑

#### 1) Run 按钮逻辑修改
- 点击后执行 `runPipeline`
- 成功后：关闭弹窗 → 自动打开 Manage 弹窗

#### 2) 监听任务事件
- 在页面加载时注册 `window.api.onTaskCreated` 和 `window.api.onTaskUpdated`
- 事件触发时刷新任务列表

#### 3) Manage 弹窗优化
- 注册 `onOutput` 监听实时 log
- 实时更新 status-pill 状态

## 后端改动

### main.js - 添加事件推送

1. **saveMeta 后推送 task-created**
   ```javascript
   mainWindow.webContents.send('task-created', { id, url, ts: new Date().toISOString() });
   ```

2. **fetch 步骤完成后推送 task-updated**
   - 需要在 orchestrator.js 的 runStep('fetch') 完成后触发

## 状态映射

前端 `info` step 映射到后端 `fetch` 任务：
- `info_start` → `fetch_start`
- `info_done` → `fetch_done`

## 任务列表刷新策略

- `task-created`：立即刷新整个列表
- `task-updated`：更新对应任务的信息（标题等）

## 预期效果

1. 用户点击 Run → 任务立即出现在左侧列表（无标题）
2. fetch 完成后 → 任务标题更新
3. 用户可随时点击任务查看进度
4. Manage 弹窗显示实时 log 和状态
