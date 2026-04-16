# WebSocket 实时通信实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 用 WebSocket 替代轮询 + IPC 事件机制，实现后端与前端的实时双向通信

**架构:** Electron 主进程运行 WebSocket 服务器，前端通过 WebSocket 接收任务状态推送和发送命令

**技术栈:** Electron, 原生 WebSocket (ws), IPC

---

## Task 1: 添加 ws 依赖

**Files:**
- Modify: `electron/package.json`
- Run: `cd electron && npm install ws`

**Step 1: 添加依赖**

```bash
cd electron && npm install ws
```

**Step 2: 验证安装**

Run: `cd electron && npm list ws`
Expected: ws@x.x.x in node_modules

**Step 3: Commit**

```bash
git add electron/package.json electron/package-lock.json
git commit -m "feat: add ws dependency for WebSocket"
```

---

## Task 2: 创建 WebSocket 服务器模块

**Files:**
- Create: `electron/src/websocket-server.js`

**Step 1: 创建 ws 服务器模块**

```javascript
// electron/src/websocket-server.js
const WebSocket = require('ws');

class WebSocketServer {
    constructor(port = 8765) {
        this.port = port;
        this.wss = null;
        this.clients = new Set();
    }

    start() {
        this.wss = new WebSocket.Server({ port: this.port });
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            console.log('[WS] Client connected');

            ws.on('message', (message) => {
                this.handleMessage(message);
            });

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log('[WS] Client disconnected');
            });
        });
        console.log(`[WS] Server started on port ${this.port}`);
    }

    handleMessage(message) {
        try {
            const data = JSON.parse(message);
            // Handle commands from frontend
            if (this.onCommand) {
                this.onCommand(data);
            }
        } catch (e) {
            console.error('[WS] Invalid message:', e);
        }
    }

    send(type, payload) {
        const data = JSON.stringify({ type, payload });
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(data);
            }
        });
    }

    broadcast(type, payload) {
        this.send(type, payload);
    }

    stop() {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
            this.clients.clear();
            console.log('[WS] Server stopped');
        }
    }
}

module.exports = WebSocketServer;
```

**Step 2: Commit**

```bash
git add electron/src/websocket-server.js
git commit -m "feat: add WebSocket server module

- Server on port 8765
- Broadcast messages to all connected clients
- Handle commands from frontend"
```

---

## Task 3: 在 main.js 集成 WebSocket 服务器

**Files:**
- Modify: `electron/src/main.js`

**Step 1: 添加 WebSocket 服务器引用**

在文件顶部添加：
```javascript
const WebSocketServer = require('./websocket-server');
```

**Step 2: 添加服务器实例变量**

```javascript
let wsServer;
```

**Step 3: 在 createWindow 函数中启动 WebSocket 服务器**

```javascript
// 启动 WebSocket 服务器
wsServer = new WebSocketServer(8765);
wsServer.start();

// 设置命令处理回调
wsServer.onCommand = async (data) => {
    console.log('[WS] Received command:', data);
    switch (data.type) {
        case 'task:cancel':
            // Handle cancel
            break;
        case 'task:pause':
            // Handle pause
            break;
        case 'task:resume':
            // Handle resume
            break;
        case 'task:refresh':
            // Handle refresh - send current status
            if (orchestrator) {
                const status = orchestrator.getStatus(data.payload.id);
                wsServer.send('task:status', status);
            }
            break;
    }
};
```

**Step 4: 添加推送方法到 Orchestrator**

在 main.js 中修改 initOrchestrator：
```javascript
function initOrchestrator() {
    orchestrator = new Orchestrator(baseDir,
        (text) => { /* onOutput */ },
        (task) => { /* onTaskCreated */ },
        (task) => { /* onTaskUpdated */ },
        (type, payload) => { /* onStepEvent - new callback */
            if (wsServer) {
                wsServer.broadcast(type, payload);
            }
        }
    );
}
```

**Step 5: Commit**

```bash
git add electron/src/main.js
git commit -m "feat: integrate WebSocket server in main.js

- Start WS server on port 8765
- Handle commands from frontend
- Broadcast task events"
```

---

## Task 4: 扩展 Orchestrator 添加步骤事件回调

**Files:**
- Modify: `electron/src/orchestrator.js`

**Step 1: 修改构造函数添加 onStepEvent 回调**

```javascript
class Orchestrator {
    constructor(baseDir, onOutput = null, onTaskCreated = null, onTaskUpdated = null, onStepEvent = null) {
        this.baseDir = baseDir;
        this.onOutput = onOutput;
        this.onTaskCreated = onTaskCreated;
        this.onTaskUpdated = onTaskUpdated;
        this.onStepEvent = onStepEvent;  // New callback
    }
```

**Step 2: 在 runStep 中添加步骤开始/完成事件**

在 runStep 开始处添加：
```javascript
// 推送步骤开始事件
if (this.onStepEvent) {
    this.onStepEvent('task:status', {
        id,
        currentStep: stepName,
        stepStatus: 'running',
        steps: meta.steps || {}
    });
}
```

在 runStep 结束时添加：
```javascript
// 推送步骤完成事件
if (this.onStepEvent) {
    this.onStepEvent('task:status', {
        id,
        currentStep: stepName,
        stepStatus: meta.steps[stepName].status,
        steps: meta.steps
    });
}
```

**Step 3: 在 run 方法中添加任务完成事件**

在 run 方法最后：
```javascript
if (this.onStepEvent) {
    this.onStepEvent('task:complete', { id });
}
```

**Step 4: Commit**

```bash
git add electron/src/orchestrator.js
git commit -m "feat: add step event callbacks to Orchestrator

- onStepEvent callback for step start/complete
- Broadcast task:status on each step
- Broadcast task:complete when all done"
```

---

## Task 5: 修改前端使用 WebSocket

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 添加 WebSocket 连接函数**

在 script 标签开头添加：
```javascript
let ws = null;
let wsReconnectInterval = null;

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    ws = new WebSocket('ws://localhost:8765');

    ws.onopen = () => {
        console.log('[WS] Connected');
        if (wsReconnectInterval) {
            clearInterval(wsReconnectInterval);
            wsReconnectInterval = null;
        }
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
    };

    ws.onclose = () => {
        console.log('[WS] Disconnected');
        // Reconnect if tasks are running
        if (!wsReconnectInterval) {
            wsReconnectInterval = setInterval(connectWebSocket, 5000);
        }
    };

    ws.onerror = (error) => {
        console.error('[WS] Error:', error);
    };
}

function handleWsMessage(data) {
    switch (data.type) {
        case 'task:status':
            updateTaskStatus(data.payload);
            break;
        case 'task:output':
            appendOutput(data.payload.text);
            break;
        case 'task:complete':
            handleTaskComplete(data.payload);
            break;
        case 'task:error':
            handleTaskError(data.payload);
            break;
    }
}
```

**Step 2: 添加任务状态更新函数**

```javascript
function updateTaskStatus(status) {
    if (status.id === currentId) {
        loadWork(status.id);
    }
    // Also refresh history list
    loadHistory();
}

function handleTaskComplete(payload) {
    if (payload.id === currentId) {
        loadWork(payload.id);
    }
    loadHistory();
}

function handleTaskError(payload) {
    if (payload.id === currentId) {
        loadWork(payload.id);
    }
    loadHistory();
}
```

**Step 3: 修改 runPipeline 函数使用 WebSocket**

修改现有 runPipeline 调用：
```javascript
async function runPipeline() {
    // 保持现有逻辑不变，只是确保 WebSocket 连接
    connectWebSocket();

    // ... existing code ...
}
```

**Step 4: 添加发送命令函数**

```javascript
function sendWsCommand(type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
    }
}

// Wrapper functions for commands
function cancelTask(id) {
    sendWsCommand('task:cancel', { id });
}

function pauseTask(id) {
    sendWsCommand('task:pause', { id });
}

function resumeTask(id) {
    sendWsCommand('task:resume', { id });
}

function refreshTask(id) {
    sendWsCommand('task:refresh', { id });
}
```

**Step 5: 修改轮询间隔**

将原来的 5 秒轮询改为 30 秒：
```javascript
window.historyRefreshInterval = setInterval(() => {
    loadHistory();
}, 30000);  // 30 seconds
```

**Step 6: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: use WebSocket for realtime updates in frontend

- Connect to ws://localhost:8765
- Handle task:status, task:output, task:complete, task:error
- Add command functions: cancel, pause, resume, refresh
- Increase polling interval to 30s as fallback"
```

---

## Task 6: 测试完整流程

**Files:**
- Test: 手动测试 WebSocket 连接和消息传递

**Step 1: 启动 Electron 应用**

```bash
cd electron && npm start
```

**Step 2: 添加一个视频任务**

观察：
- WebSocket 连接成功
- 任务创建时收到 task:status
- 每个步骤开始/完成时收到 task:status 更新
- 任务完成时收到 task:complete

**Step 3: 测试命令功能**

- 点击刷新按钮测试 task:refresh 命令

**Step 4: Commit**

```bash
git commit --allow-empty -m "test: verify WebSocket functionality

- WebSocket connection established
- Task events received correctly
- Commands working"
```

---

## 总结

实现计划包含 6 个任务：

1. 添加 ws 依赖
2. 创建 WebSocket 服务器模块
3. 在 main.js 集成 WebSocket 服务器
4. 扩展 Orchestrator 添加步骤事件回调
5. 修改前端使用 WebSocket
6. 测试完整流程
