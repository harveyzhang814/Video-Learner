# GUI 重试单步功能 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在主界面点击失败的 step pill 打开重试确认弹窗，确认后调用 runStep(force:true)，弹窗内展示本次重试的 loading 与独立 log；关闭时刷新主界面 pill。API 无改动。

**Architecture:** 独立弹窗 `#retryConfirmModal` 两阶段（确认 → 进行中）。主界面 `#infoStatus` 仅 error 的 pill 可点击并 hover 显示「重试」。复用现有 SSE，在 handler 中按 `retrySession` 将本次重试的 log 额外追加到 `#retryModalLog`。关闭弹窗时 `getTask` + `applyTaskToInfo`。

**Tech Stack:** 现有 Electron renderer（单文件 `index.html` + `service-client.js`），无新依赖。设计文档：`docs/plans/2026-03-15-gui-retry-step-design.md`。

---

## Task 1: 常量与 step 中文名映射

**Files:**
- Modify: `electron/src/renderer/index.html`（在 STEPS 定义附近，约 1734 行后）

**Step 1: 添加 STEP_LABELS 映射**

在 `const STEPS = ['fetch', ...];` 后增加：

```javascript
const STEP_LABELS = {
  fetch: '获取信息',
  video: '视频下载',
  audio: '音频下载',
  subs: '字幕下载',
  vtt2md: '转换文案',
  md2vtt: '字幕生成',
  article: '文章生产',
  summary: '提炼总结'
};
```

**Step 2: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "chore: add STEP_LABELS for retry modal title"
```

---

## Task 2: 重试弹窗 DOM 与样式

**Files:**
- Modify: `electron/src/renderer/index.html`
  - 在 `#newTaskModal` 之后、`#confirmDeleteModal` 之前插入新弹窗 DOM（约 1655 行前）
  - 在 `<style>` 内增加重试弹窗与失败 pill hover 样式

**Step 1: 插入重试弹窗 HTML**

在 `</div>`（newTaskModal 的闭合）与 `<!-- Confirm Delete Modal -->` 之间插入：

```html
<!-- Retry Step Modal -->
<div class="modal-overlay hidden" id="retryConfirmModal">
  <div class="modal retry-modal">
    <div class="modal-header">
      <span class="modal-title" id="retryModalTitle">是否重试？</span>
      <button class="modal-close" id="retryModalClose" type="button">&times;</button>
    </div>
    <div class="modal-content">
      <div id="retryModalPhaseConfirm">
        <div class="input-group">
          <label class="checkbox-label">
            <input type="checkbox" id="retryModalAutoNext" disabled>
            <span class="checkbox-custom"></span>
            <span>自动执行后续步骤？</span>
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="retryModalCancel">取消</button>
          <button type="button" class="btn primary" id="retryModalConfirm">确认</button>
        </div>
      </div>
      <div id="retryModalPhaseRunning" class="hidden">
        <div class="retry-modal-loading" id="retryModalLoading">重试中…</div>
        <div class="modal-logs retry-modal-logs" id="retryModalLog"></div>
      </div>
    </div>
  </div>
</div>
```

**Step 2: 添加样式**

在 `.status-pill.error` 后增加：

```css
.status-pill.error.clickable {
  cursor: pointer;
}
.status-pill.error.clickable:hover {
  filter: brightness(0.95);
  border-color: var(--text-muted);
}
.status-pill.error .retry-hint {
  margin-left: 4px;
  font-size: 11px;
  opacity: 0.9;
}
```

在 `.reset-popup` 前或合适位置增加：

```css
#retryModalPhaseRunning.visible { display: block; }
.retry-modal-loading { margin-bottom: 12px; color: var(--text-muted); }
.retry-modal-logs { max-height: 240px; overflow-y: auto; }
```

**Step 3: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): add retry confirm modal DOM and error pill hover styles"
```

---

## Task 3: 重试弹窗打开/关闭与阶段切换

**Files:**
- Modify: `electron/src/renderer/index.html`（script 内，与 modal 相关变量一起）

**Step 1: 获取弹窗 DOM 引用**

在 `confirmDeleteOk` 等引用后增加：

```javascript
const retryConfirmModal = document.getElementById('retryConfirmModal');
const retryModalTitle = document.getElementById('retryModalTitle');
const retryModalClose = document.getElementById('retryModalClose');
const retryModalPhaseConfirm = document.getElementById('retryModalPhaseConfirm');
const retryModalPhaseRunning = document.getElementById('retryModalPhaseRunning');
const retryModalLog = document.getElementById('retryModalLog');
const retryModalCancel = document.getElementById('retryModalCancel');
const retryModalConfirm = document.getElementById('retryModalConfirm');
```

**Step 2: 实现打开/关闭与阶段切换**

- `openRetryModal(taskId, stepName)`：设置标题为 `是否重试${STEP_LABELS[stepName]}？`；显示 phaseConfirm、隐藏 phaseRunning；清空 `#retryModalLog`；从 body 移入并移除 `hidden`（若弹窗在别处），显示蒙层。
- `closeRetryModal()`：加 `hidden`，可选移回原位置。若存在 `currentTaskId`，调用 `client.getTask(currentTaskId)` 然后 `applyTaskToInfo(task)`。
- `switchRetryModalToRunning()`：隐藏 phaseConfirm，显示 phaseRunning（加 visible 或去 hidden），清空 `#retryModalLog`。

**Step 3: 绑定关闭与取消**

- `retryModalClose`、`retryModalCancel`、点击蒙层（`retryConfirmModal` 的 overlay）：调用 `closeRetryModal()`。
- `retryModalConfirm`：在 Task 4 中绑定。

**Step 4: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): retry modal open/close and phase switch"
```

---

## Task 4: 主界面 pill 点击与确认发起 runStep

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 重试会话状态**

在 script 顶层（如 `let currentTaskId = null;` 附近）增加：

```javascript
let retrySession = null; // { taskId, stepName, startTime } when phase running
```

**Step 2: 仅 error pill 可点击并显示重试**

- 在 `applyTaskToInfo` 中，对每个 step 设置完 `setPillState` 后，若该 step 为 `error`，给对应 pill 添加 class `clickable`、设置 `title="重试"`（或在其内增加 `.retry-hint` 文案「重试」）；否则移除 `clickable`、去掉 title/retry-hint。
- 使用事件委托：在 `#infoStatus` 上监听 `click`，若 `e.target.closest('.status-pill.error.clickable')` 存在，取 `data-step`，若存在 `currentTaskId` 且当前任务该 step 为 failed，则 `openRetryModal(currentTaskId, stepName)`。

**Step 3: 确认按钮发起 runStep**

- `retryModalConfirm` 点击：若 !client 或 !currentTaskId 则 return。取当前弹窗对应的 step（需在 open 时存到 data 或闭包，例如 `retryModalConfirm.dataset.step` 或模块级 `pendingRetryStep`）。调用 `client.runStep(currentTaskId, stepName, { force: true })`。
  - 请求成功（无 throw）：设置 `retrySession = { taskId: currentTaskId, stepName, startTime: Date.now() }`；`switchRetryModalToRunning()`；禁用确认按钮（可选）。
  - 请求失败：catch 后 toast 或 alert「重试请求失败，请稍后再试」，不切换阶段。
- 打开弹窗时把 stepName 存到 `pendingRetryStep` 或 data 属性，确认时读取。

**Step 4: 关闭时清空 retrySession**

在 `closeRetryModal()` 内：`retrySession = null`；并执行 `getTask` + `applyTaskToInfo`。

**Step 5: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): wire pill click to retry modal and confirm to runStep"
```

---

## Task 5: SSE 向 #retryModalLog 追加本次重试日志

**Files:**
- Modify: `electron/src/renderer/index.html`（SSE 事件处理处，约 2532–2553 行）

**Step 1: 追加到弹窗 log 的辅助函数**

在 `appendLogLine` 附近增加：

```javascript
function appendRetryModalLog(text) {
  if (!retryModalLog) return;
  const div = document.createElement('div');
  div.className = 'log-line';
  const ts = new Date().toLocaleTimeString();
  const cls = /error|failed/i.test(text) ? 'log-err' : '';
  div.innerHTML = `<span class="log-ts">[${ts}]</span><span class="${cls}">${escapeHtml(text)}</span>`;
  retryModalLog.appendChild(div);
  retryModalLog.scrollTop = retryModalLog.scrollHeight;
}
```

**Step 2: 在 task.updated / step.started / step.finished 中追加到 retryModalLog**

在现有 `if (type === 'task.updated' || type === 'step.started' || type === 'step.finished')` 分支内，在 `appendLogLine(taskId, ...)` 之后增加：

若 `retrySession && retrySession.taskId === taskId`，则 `appendRetryModalLog` 同一行内容（或与 appendLogLine 相同格式的字符串）。

**Step 3: 在 log.appended 中追加到 retryModalLog**

在 `if (type === 'log.appended')` 分支内，在现有 `appendLogLine` 之后：若 `retrySession && retrySession.taskId === taskId`，则 `appendRetryModalLog(text)`。

**Step 4: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): stream retry session logs to retry modal only"
```

---

## Task 6: 边界与体验收尾

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 打开弹窗时校验任务**

在 `openRetryModal` 内（或点击 pill 时）：先 `getTask(currentTaskId)`，若失败或任务不存在，不打开弹窗并可选 toast；若存在则检查 `task.steps[stepName].status === 'failed'` 再打开。

**Step 2: 阶段二时忽略其他 pill 点击**

若 `retrySession !== null`，在 `#infoStatus` 的 click 委托里直接 return，不打开新弹窗（或先关闭当前弹窗再打开新的，选其一并在设计里保持一致）。

**Step 3: 确认按钮防重复**

点击确认后、请求发出前将 `retryModalConfirm.disabled = true`；请求失败时恢复；关闭弹窗时恢复。

**Step 4: 手动验证**

- 启动应用，选中一个存在 failed step 的任务；确认主界面该 pill 为 error、hover 显示「重试」、点击打开弹窗。
- 确认弹窗标题为「是否重试\<步骤名\>？」、配置项禁用、取消/关闭可关闭。
- 点击确认后弹窗变为 loading + log，主界面对应 pill 变为 active；关闭弹窗后主界面 pill 刷新为最新状态。
- runStep 失败时停留在阶段一并提示。

**Step 5: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "fix(gui): retry modal validation, concurrency and confirm debounce"
```

---

## 执行说明

- 按 Task 1 → 6 顺序执行；每 Task 内按 Step 顺序完成并 commit。
- 设计细节以 `docs/plans/2026-03-15-gui-retry-step-design.md` 为准；本计划未写的 UI 细节（如「字幕生成」是否改为「转字幕」）可保持与现有 `#infoStatus` 一致。

**Plan complete and saved to `docs/plans/2026-03-15-gui-retry-step-impl-plan.md`.**

两种执行方式：

1. **Subagent-Driven（本会话）** — 按任务派发子 agent，每任务后你做 review，迭代快。
2. **Parallel Session（新会话）** — 在新会话中用 executing-plans，在独立 worktree 里按检查点批量执行。

需要哪种？
