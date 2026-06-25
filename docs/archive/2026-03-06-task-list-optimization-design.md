# 任务列表与日志优化设计

## 背景

当前系统存在问题：
1. 任务进行中时，侧边栏列表不显示该任务
2. 弹窗关闭后，任务从列表消失，无法再次打开查看
3. 日志只显示最新内容，关闭弹窗后丢失

## 目标

1. 进行中的任务显示在侧边栏列表中，带有状态颜色
2. 所有日志持久化存储，可随时查看
3. 弹窗关闭后任务仍在后台运行，可重新打开查看进度

## 方案

### 1. 侧边栏列表状态显示

**数据结构扩展**：
```javascript
// 列表项增加 status 字段
{
  id: "xxx",
  title: "视频标题",
  ts: "2024-01-01",
  status: "running" | "completed" | "failed",
  done: boolean // 保留用于兼容性
}
```

**状态颜色**：
- `running`: #FFD700 (黄色)
- `completed`: #22C55E (绿色)
- `failed`: #EF4444 (红色)

**实现**：
- 任务开始时，立即创建目录和空的 meta.json（标记为进行中）
- 主进程任务完成时更新 meta.json 状态
- 前端轮询更新列表状态（或通过 IPC 事件通知）

### 2. 日志持久化存储

**存储位置**：`work/<id>/media/task.log`

**实现**：
- 主进程在接收 stdout 数据时，同时写入文件
- 前端弹窗打开时读取该文件加载历史日志
- 实时日志继续通过 IPC 推送

```javascript
// main.js 伪代码
proc.stdout.on('data', (data) => {
  const text = data.toString();
  output += text;
  mainWindow.webContents.send('pipeline-output', text);

  // 追加写入日志文件
  fs.appendFile(logPath, text);
});
```

### 3. 任务可重新打开

**触发条件**：
- 点击侧边栏任意任务
- 如果任务正在运行，弹出详情弹窗并绑定实时日志

**实现**：
- 弹窗关闭时不断开任务，任务继续在后台运行
- 重新打开弹窗时，重新绑定 `onOutput` 监听器
- 加载历史日志文件内容

## 改动文件

1. **electron/src/main.js**
   - 任务开始时创建目录和初始 meta.json
   - 日志实时写入文件
   - 任务完成时更新状态

2. **electron/src/renderer/index.html**
   - 列表渲染增加状态颜色
   - 弹窗日志加载历史记录
   - 弹窗关闭时继续运行任务

## 兼容性

- 已有任务不受影响（无 status 字段时默认为 completed）
- 日志文件为追加模式，旧任务无日志文件不影响显示
