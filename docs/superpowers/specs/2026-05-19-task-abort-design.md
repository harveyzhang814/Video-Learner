# Task Abort Mechanism Design

**Date:** 2026-05-19  
**Status:** Approved

## Overview

为任务和步骤添加中止（abort）能力。中止后任务重置为 `pending` 状态，可直接重跑。

---

## 1. 核心数据结构 & Orchestrator

### Task 对象新增字段

```js
{
  // 现有字段不变...
  _abortFlag: false,      // 是否已请求中止（任务级）
  _currentProc: null,     // 当前正在运行的 ChildProcess
  _abortResolvers: []     // 等待进程退出的 Promise resolve 列表
}
```

这三个字段均为运行时内存状态，不持久化到 SQLite。

### `runStepScript` 改动

- `spawn` 加 `detached: true`，使 bash 及其所有子进程（yt-dlp、ffmpeg、claude、opencode）属于同一进程组
- spawn 后立即：`task._currentProc = proc`
- `proc.on('close', ...)` 时：
  - 清空 `task._currentProc = null`
  - 依次调用并清空 `task._abortResolvers`

### `runTask` DAG 循环改动

每轮 `pickNextStep` 之后、`await runStep(...)` 之前插入检查：

```js
if (task._abortFlag) break;
```

循环退出后若 `_abortFlag` 为 true，将任务状态重置为 `pending`。

### 新增：`abortTask(taskId, options)`

```
1. 校验任务存在且状态为 running，否则抛出 TASK_NOT_RUNNING（code: 'NOT_RUNNING'）
2. 设 task._abortFlag = true
3. 若 task._currentProc 存在：
   a. process.kill(-proc.pid, 'SIGTERM')
   b. 返回一个 Promise，push resolve 到 task._abortResolvers
   c. 5 秒超时后若进程未退出，执行 process.kill(-proc.pid, 'SIGKILL')
4. 等待进程退出
5. 按步骤类型清理输出文件：
   - video / audio 步骤：保留部分文件（支持后续续传）
   - article / summary 步骤：删除不完整的输出文件
6. 将当前运行步骤的 status 重置为 pending（SQLite + 内存）
7. 重置 task.status = 'pending'，task._abortFlag = false，task._currentProc = null
8. 触发 SSE 事件：task.updated { status: 'pending' }
```

### 新增：`abortStep(taskId, stepName, options)`

```
1. 校验任务存在，且指定步骤当前 status === 'running'，否则抛出 STEP_NOT_RUNNING
2. 校验 task._currentProc 存在
3. process.kill(-proc.pid, 'SIGTERM')（同样 5 秒超时后 SIGKILL）
4. 等待进程退出
5. 同样按步骤类型清理输出文件
6. 将该步骤 status 重置为 pending（SQLite + 内存）
7. 不设 _abortFlag，DAG 循环继续调度后续步骤
8. 触发 SSE 事件：step.finished { stepName, status: 'pending', aborted: true }
```

---

## 2. HTTP API

### 任务级中止

```
POST /api/tasks/:taskId/cancel
Authorization: Bearer <token>
```

- 无 request body
- 同步等待进程退出后响应
- **200** `{ task_id, status: "pending" }`
- **404** 任务不存在
- **409** `{ error, code: "NOT_RUNNING" }` 任务未在运行

### 步骤级中止

```
POST /api/tasks/:taskId/steps/:stepName/cancel
Authorization: Bearer <token>
```

- 无 request body
- 同步等待进程退出后响应
- **200** `{ task_id, step: stepName, status: "pending" }`
- **404** 任务或步骤不存在
- **409** `{ error, code: "STEP_NOT_RUNNING" }` 该步骤未在运行

### SSE 事件

复用现有事件类型，无需新增：

| 场景 | 事件类型 | payload 变化 |
|------|----------|-------------|
| 任务级中止完成 | `task.updated` | `{ status: "pending" }` |
| 步骤级中止完成 | `step.finished` | `{ stepName, status: "pending", aborted: true }` |

---

## 3. Electron GUI

### Preload 新增方法

```js
// contextBridge 暴露，与现有 API 模式一致
cancelTask(taskId)               // POST /api/tasks/:taskId/cancel
cancelStep(taskId, stepName)     // POST /api/tasks/:taskId/steps/:stepName/cancel
```

走现有 HTTP 调用封装，无需新增 IPC 通道。

### Renderer 交互

- 任务卡片处于 `running` 状态时，显示**「中止」按钮**（与现有「重跑」按钮同区域）
- 点击后按钮变为 loading / 禁用，等待 HTTP 200
- 返回后任务状态变为 `pending`，UI 恢复（可重新运行）

---

## 4. 步骤清理策略

| 步骤 | 中止后文件处理 |
|------|--------------|
| `fetch` | 无持久产物，无需处理 |
| `video` | 保留部分 `video.mp4`（可续传） |
| `audio` | 保留部分 `audio.m4a`（可续传） |
| `subs` | 保留已下载的 `.vtt` 文件 |
| `asr` | 无特殊处理 |
| `vtt2md` | 无特殊处理（源文件未删） |
| `md2vtt` | 无特殊处理 |
| `article` | 删除不完整的 `article.md` |
| `summary` | 删除不完整的 `summary.md` |

---

## 5. 不在本次范围内

- 并发任务场景下的多 proc 管理（当前为单任务串行）
- 中止历史记录 / audit log
- 超时自动中止
