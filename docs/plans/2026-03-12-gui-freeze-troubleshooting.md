# GUI 卡死问题排查清单

> 若创建任务后或运行中仍出现界面卡死，可按下列位置逐项排查。所有修复均仅限 Electron 渲染进程，不涉及 agent service 除非单独评估。

---

## 1. SSE 事件风暴导致频繁 refreshHistory（最可能）

**位置**：`electron/src/renderer/index.html` 中 `setupEvents()` 的 `handle` 回调。

**现象**：任务运行时会收到大量事件（task.created、task.updated、step.started、step.finished、log.appended）。当前逻辑在 **每一条** `task.updated` / `step.started` / `step.finished` 时都会 `await refreshHistory()`。  
`refreshHistory()` 会请求 `listTasks` 并执行 `renderHistory(rows)`：重绘整份任务列表（innerHTML + 为每项绑定点击）。若几秒内收到 10+ 条事件，就会连续 10+ 次全列表重绘，主线程被占满，表现为卡死。

**代码位置**：
- `task.created` → `await refreshHistory()`
- `task.updated` / `step.started` / `step.finished` → 若命中当前任务会 `getTask` + `applyTaskToInfo`，然后 **`await refreshHistory()`**

**建议**：
- 对「由 SSE 触发的 refreshHistory」做 **防抖**（如 300–500ms 内只执行最后一次），避免事件风暴时连续刷列表。
- 或仅在 `task.created` 时刷新列表；`task.updated` / `step.*` 只更新当前任务详情（applyTaskToInfo），不刷新整表。

---

## 2. renderHistory 单次过重

**位置**：`renderHistory(tasks)`。

**现象**：任务数量大（如 limit 200）时，一次 `renderHistory` 会：大字符串拼接、一次 innerHTML、再 `querySelectorAll('.history-item')` 并为每项 addEventListener。若再叠加「1」中的频繁调用，容易卡顿。

**建议**：
- 先做「1」的防抖，通常即可缓解。
- 若仍不够：限制列表展示条数（如最多 50）、或对列表做虚拟滚动（只渲染可见项）。

---

## 3. log.appended 暴量导致 appendLogLine 过多

**位置**：SSE `handle` 中 `type === 'log.appended'` → `appendLogLine(taskId, text, { seq })`。

**现象**：若后端短时间内推送大量日志行，每条都会执行一次 `appendLogLine`（push 到 state + 创建 div、appendChild、scrollTop）。大量 DOM 操作会阻塞主线程。

**建议**：
- **批处理**：在内存中缓冲最近 50–100ms 的 log 行，定时或达到条数后一次性 append 一个 documentFragment，再挂到 modalLogs。
- 或对日志区域做**虚拟列表**（只渲染可见行），避免 DOM 节点无限增长。

---

## 4. getTask() 慢或挂起

**位置**：`selectTask()`、`openManageModal()`、SSE 的 resync / task.updated 分支中 `client.getTask(...)`。

**现象**：若服务端响应慢或请求挂起，await getTask 会长时间不返回，表现为「点击选中或打开 Manage 后一直转/无反应」。通常不会整页卡死，但会让人误以为卡死。

**建议**：
- 前端对 getTask 设**超时**（如 15s），超时后提示并恢复 UI。
- 在 selectTask / openManageModal 中加 **loading 状态**（如按钮禁用、文案「加载中」），避免用户重复点击。

---

## 5. 创建任务后的链式调用仍过重

**位置**：创建任务成功后的 `setTimeout(runAfterCreate, 0)` 内：`refreshHistory()` → `selectTask(taskId)` → `openManageModal()`。

**现象**：虽已用 setTimeout 分步，若单步内仍有大量同步 DOM 操作（如 selectTask 里对很多 log 行做 innerHTML/appendChild，或 openManageModal 里大量 pills 更新），仍可能在一帧内阻塞过久。

**建议**：
- 创建成功后**不自动打开 Manage**，只做 refreshHistory + selectTask（仅主面板选中并展示详情），用户需要时再点 Manage。可显著减少创建后的工作量。
- 或保持自动打开 Manage，但确保 selectTask 中渲染日志、openManageModal 中更新 pills 均为「有限循环 + 必要时 requestAnimationFrame 分帧」。

---

## 6. 其他

- **Electron 主进程**：若主进程在 IPC 或子进程管理中有阻塞或死锁，也可能导致渲染进程看起来无响应；通常需看主进程日志与 CPU。
- **内存**：长时间运行且日志/任务列表无限增长，可能触发 GC 或内存压力，间接导致卡顿；可配合「2」「3」的限流或虚拟化。

---

## 实施优先级

1. **先做**：对 SSE 触发的 `refreshHistory` 做防抖（见「1」）。
2. 若仍卡：再考虑创建后不自动打开 Manage（见「5」）或对 log 做批处理（见「3」）。
3. 列表/日志虚拟化与 getTask 超时可按需再加。
