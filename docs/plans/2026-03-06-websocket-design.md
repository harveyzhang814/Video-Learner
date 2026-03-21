# WebSocket 实时通信设计

## 目标

用 WebSocket 替代现有的轮询 + IPC 事件机制，实现后端与前端的实时双向通信。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │ WebSocket  │◀──▶│ Orchestrator│◀──▶│  步骤脚本执行   │  │
│  │ Server     │    │             │    │ (fetch/video/..)│ │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
│         │                   │                                   │
│         │                   ▼                                   │
│  ┌─────────────┐    ┌─────────────┐                           │
│  │ meta.json   │◀───│  状态管理    │                           │
│  └─────────────┘    └─────────────┘                           │
└─────────────────────────────────────────────────────────────┘
                            │
                    WebSocket (ws://localhost:8765)
                            │
┌─────────────────────────────────────────────────────────────┐
│                    Electron Renderer (Frontend)            │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐    │
│  │ WS Client   │◀──▶│  状态机     │◀──▶│  UI 更新     │    │
│  └─────────────┘    └─────────────┘    └──────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## 消息格式

### 后端 → 前端 (推送)

```javascript
// 任务状态更新
{ type: 'task:status', payload: {
    id: 'abc123',
    currentStep: 'video',
    stepStatus: 'running',  // pending/running/completed/failed
    steps: {
      fetch: { status: 'completed' },
      video: { status: 'running' },
      subs: { status: 'pending' },
      vtt2md: { status: 'pending' },
      md2vtt: { status: 'pending' },
      article: { status: 'pending' },
      summary: { status: 'pending' }
    }
}}

// 任务输出日志
{ type: 'task:output', payload: { text: '...' } }

// 任务完成
{ type: 'task:complete', payload: { id: 'abc123' } }

// 任务失败
{ type: 'task:error', payload: { id: 'abc123', error: '...' } }
```

### 前端 → 后端 (命令)

```javascript
// 取消任务
{ type: 'task:cancel', payload: { id: 'abc123' } }

// 暂停任务
{ type: 'task:pause', payload: { id: 'abc123' } }

// 恢复任务
{ type: 'task:resume', payload: { id: 'abc123' } }

// 手动刷新状态
{ type: 'task:refresh', payload: { id: 'abc123' } }
```

## 事件触发时机

| 事件 | 触发时机 |
|------|----------|
| `task:status` | 每个步骤开始时 + 步骤状态变化时 |
| `task:output` | 实时输出（保留现有 onOutput） |
| `task:complete` | 所有步骤完成 |
| `task:error` | 任何步骤失败 |

## WebSocket 生命周期

```
[前端发起任务] → [建立 WS 连接] → [接收实时推送]
       ↑                                      ↓
       │           所有任务完成时断开           │
       └──────────────────────────────────────┘
```

| 状态 | 行为 |
|------|------|
| 无任务运行 | 不建立连接 |
| 有任务运行 | 保持连接，实时推送 |
| 所有任务完成 | 断开 WebSocket |
| 页面关闭 | 断开连接 |

## 轮询策略

- **WebSocket 为主**：实时推送状态
- **轮询为辅**：间隔 30 秒，WebSocket 断开时作为 fallback
- **手动刷新**：用户可随时点击刷新按钮

## 改动范围

| 文件 | 改动 |
|------|------|
| `electron/src/main.js` | 添加 WebSocket 服务器，任务管理 |
| `electron/src/orchestrator.js` | 添加步骤开始/完成回调，触发 WS 推送 |
| `electron/src/preload.js` | 暴露 WebSocket URL 或 WS 客户端辅助方法 |
| `electron/src/renderer/index.html` | 替换 IPC 事件为 WebSocket 监听 |

## 兼容性

- 保留现有 IPC 接口（`run-pipeline`, `run-step` 等）供外部调用
- WebSocket 作为前端实时通信的主要方式
