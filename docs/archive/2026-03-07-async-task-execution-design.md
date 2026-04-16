# 异步任务执行 - 弹窗状态实时更新设计

## 背景

当前弹窗在新建任务模式下，状态更新依赖于日志中的 `[STATUS]` 标记，存在以下问题：
1. 有些任务状态不刷新，始终是初始状态
2. 状态更新机制与主界面不一致（主界面从数据库查询）

## 目标

让弹窗使用与主界面相同的机制：通过 `task:status` WebSocket 消息，从数据库查询最新状态。

## 方案：异步执行，立即返回 ID

### 核心改动

```
当前流程（同步）：
1. 前端调用 runPipeline()
2. main.js 等待 orchestrator.run() 完全执行完成
3. 返回 result（包含 id）给前端
4. 前端关闭弹窗，加载任务

改为异步流程：
1. 前端调用 runPipeline()
2. main.js 立即生成 ID，立即返回给前端
3. orchestrator.run() 在后台继续执行（不阻塞）
4. 前端拿到 ID 后，弹窗立即切换到"编辑模式"
5. 通过 WebSocket 接收 task:status 消息更新状态
6. 任务完成时发送 task:complete 消息
```

### 数据流

```
前端 runPipeline(url, options)
    ↓
main.js: generateId(url) → 立即返回 { id, success: true }
    ↓
弹窗设置 modalTaskId = id，切换到编辑模式
    ↓
orchestrator.run() 在后台执行
    ↓
onStepEvent('task:status') → WebSocket 广播
    ↓
前端 handleWsMessage → loadWork(id) 从数据库读取
    ↓
弹窗状态更新
```

## 实现步骤

### 1. main.js - 异步执行任务

修改 `ipcMain.handle('run-pipeline')`：
- 立即生成 task ID
- 立即返回给前端
- 在后台启动 orchestrator.run()（不 await）

### 2. 前端 - 弹窗切换编辑模式

修改 `runNewTask()`：
- 收到响应后，设置 `modalTaskId = res.id`
- 弹窗切换到编辑模式（显示任务状态）
- 通过 WebSocket 监听 task:status 更新

### 3. 前端 - 处理 task:status

在 WebSocket handler 中：
- 如果当前有弹窗打开且 modalTaskId 匹配
- 调用 loadWork(modalTaskId) 从数据库读取状态
- 更新弹窗状态

### 4. 处理任务完成

- 监听 task:complete 消息
- 弹窗显示完成状态

## 代码位置

| 文件 | 改动 |
|------|------|
| `electron/src/main.js` | run-pipeline handler 改为异步 |
| `electron/src/renderer/index.html` | 弹窗获取 ID 后切换编辑模式，task:status 处理 |

## 测试场景

1. 新建任务模式：弹窗输入 URL → 点击运行 → 立即切换编辑模式 → 状态实时更新
2. 编辑模式：已有任务点击继续执行 → 状态实时更新
