# GUI 重试单步功能设计

> 目标：在主界面通过点击执行失败的 step pill 打开独立「重试确认」弹窗，确认后发起单步重试，弹窗内展示本次重试的加载与日志；允许进行中关闭弹窗，关闭时刷新主界面 pill 状态。API 无改动，仅前端实现。

---

## 1. 范围与入口

**触发条件**

- **入口**：主界面右侧信息区的步骤状态条 `#infoStatus`（8 个 status-pill）。
- **可点击**：仅当**当前选中任务**（`currentTaskId`）存在，且该 pill 对应步骤状态为 **failed**（`task.steps[step].status === 'failed'`）时，该 pill 可点击并显示 hover。
- **不可点击**：pending / active / done 的 pill 不响应点击；非 error 状态不显示「重试」hover。

**Step 与标题文案**

- 弹窗主标题：「是否重试 \<步骤中文名\>？」
- 步骤 key 与中文名一一对应（与现有 `#infoStatus` 的 `.label` 一致）：

| data-step | 标题用中文名 |
|-----------|--------------|
| fetch | 获取信息 |
| video | 视频下载 |
| audio | 音频下载 |
| subs | 字幕下载 |
| vtt2md | 转换文案 |
| md2vtt | 字幕生成 |
| article | 文章生产 |
| summary | 提炼总结 |

**边界**

- 无选中任务时不出现可点击失败 pill。若选中任务无 failed step，则无 pill 进入可点击态。

---

## 2. 弹窗结构

**弹窗身份**

- 新建独立弹窗，id：`retryConfirmModal`（或 `retryModal`）。与 `#newTaskModal` 平级，蒙层 + 居中内容区，风格与现有弹窗一致。

**阶段一：确认**

- **主标题**：「是否重试\<步骤中文名\>？」（如「是否重试字幕下载？」）。
- **配置区**：布尔选项「自动执行后续步骤？」——保留在 DOM，**不启用**（checkbox disabled 或仅展示不可点），不参与请求。
- **按钮**：取消（关闭弹窗）、确认（发起重试并进入阶段二）。

**阶段二：进行中**

- **加载**：弹窗内显示加载动画（如 spinner），风格与 `.status-pill.active` 一致。
- **日志**：弹窗内独立 log 区域 `#retryModalLog`。确认并成功发起 runStep 后清空该区域，只追加本次重试产生的日志（见第 4 节）。
- **关闭**：提供 × 或蒙层关闭；进行中允许关闭，关闭时刷新主界面 pill 状态。

**布局**

- 确认阶段：标题 + 配置区 + 按钮区，纵向排列。
- 进行中阶段：同一弹窗内容区切换为「加载动画 + 可滚动 log 区域」（log 设最大高度）。

---

## 3. 交互与状态

**主界面失败 pill**

- 仅 **error** 状态的 pill 增加 hover 样式，hover 时显示「重试」文案（title 或同层小字）。
- 仅 error 的 pill 可点击；点击后打开重试确认弹窗，传入 `currentTaskId` 与 `data-step`。

**弹窗内流程**

1. 打开：阶段一（标题 + 配置区 + 取消/确认）。
2. 确认：点击「确认」→ 调用 `client.runStep(currentTaskId, stepName, { force: true })`；请求发出后清空弹窗 log、切换到阶段二（loading + log），开始只向该 log 追加本次重试日志。
3. 进行中：SSE 的 step/log 事件在本次重试会话内写入 `#retryModalLog`；主界面 `#infoStatus` 通过现有 SSE 或关闭时刷新显示进行中（active）。
4. 关闭：× 或蒙层关闭；关闭时若存在 `currentTaskId`，执行 `getTask(currentTaskId)` 并 `applyTaskToInfo(task)`，刷新主界面 8 个 pill。

**主界面 pill 进行中**

- 重试发起后步骤变为 running；现有 `task.updated` / `step.*` 已会触发 `applyTaskToInfo`，主界面 pill 会变为 active。关闭弹窗时再刷新一次保证状态一致。

---

## 4. 数据与 API

**数据**

- 任务与步骤：`currentTaskId`，步骤状态来自 `taskCache` 或 `getTask` 的 `task.steps`。
- Step 中文名：固定映射表（如 `STEP_LABELS`），不依赖 DOM。

**API**

- 重试：`client.runStep(currentTaskId, stepName, { force: true })`。
- 关闭时刷新：`client.getTask(currentTaskId)` → `applyTaskToInfo(task)`。

**SSE 与弹窗 log**

- 复用现有 EventSource 与事件；不新建连接。
- 在用户点击「确认」并成功发出 runStep 时，设置「重试会话」标记（如 `retrySession = { taskId, stepName, startTime }`），清空 `#retryModalLog`。
- 在现有 SSE handler 中，若事件属于本次重试会话（taskId 匹配且时间在 startTime 之后，或简化为：弹窗处于阶段二且 taskId/step 匹配），则**额外**向 `#retryModalLog` 追加一行；不改变现有 `#modalLogs` 的追加逻辑。
- 弹窗关闭时清空 `retrySession`，后续事件不再写入 `#retryModalLog`。

**API 无改动**：现有 `POST .../steps/:stepName/run`（force）、`GET .../tasks/:id`、SSE 事件均无需服务端修改。

---

## 5. 错误与边界

- **未选任务 / 任务无效**：打开弹窗时可用 `getTask(currentTaskId)` 校验；404 或失败则关闭弹窗并可选 toast「任务不存在」，不发起 runStep。
- **runStep 请求失败**：toast 或弹窗内提示「重试请求失败，请稍后再试」，停留在阶段一，不切换阶段二；用户可再次确认或取消。
- **进行中关闭后再点同一 pill**：关闭时已刷新 pill；若仍为 failed 可再次打开并重试；若已 running/completed 则 pill 非 error，不可点。
- **步骤完成后弹窗未关**：不强制自动关闭；可选在弹窗内显示「已完成」文案；用户关闭时照常刷新主界面。
- **并发**：同一时间仅一个重试会话；阶段二时忽略其他 pill 点击，或关闭当前弹窗后再响应新点击（实现二选一）。

---

## 6. 实现要点小结

- 仅前端改动：`electron/src/renderer/index.html`（或拆分出的 JS）：新弹窗 DOM、STEP_LABELS、pill 点击/ hover、runStep 调用、retrySession、SSE 分支写入 `#retryModalLog`、关闭时刷新。
- 样式：失败 pill hover、弹窗两阶段布局、loading、log 区域与现有风格统一。
- 不修改 `service-client.js`、HTTP 服务或 core 编排层。
