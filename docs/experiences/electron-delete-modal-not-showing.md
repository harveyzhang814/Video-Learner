# Electron 删除确认弹窗不显示 — 经验总结

**现象**：主界面点击 Delete 按钮后，确认删除弹窗（蒙版 + 居中弹窗）不出现，且控制台无报错。

**受众**：产品经理、前端/Electron 开发。

---

## 一、问题原因（给开发）

### 1. 弹窗虽在 DOM 中，但被「压」在下面

- 确认删除弹窗的 HTML 与 New Task 弹窗是**兄弟节点**，都挂在 `body` 下、位于 `.app` 之后。
- 在部分 Electron/Chromium 环境下，**DOM 顺序与 stacking context** 会导致后渲染的 overlay 仍被主布局或其它层遮挡，即使设置了较高 `z-index`（如 9999），弹窗依然不可见。
- 表现是：点击逻辑正常执行（`classList.remove('hidden')` 已调用），但用户看不到弹窗。

### 2. Inline `onclick` 在隔离环境下的风险（历史因素）

- 删除按钮曾使用 `onclick="window.showDeleteConfirm()"`。
- 在 Electron 的 `contextIsolation: true` 下，inline 回调里的 `window` 可能与模块里挂载的 `window.showDeleteConfirm` 不一致，导致点击无响应。
- 当前版本已改为在脚本内 `deleteBtn.addEventListener('click', ...)`，不再依赖 inline。

---

## 二、最终解决方案（给开发）

1. **独立蒙版 + 高 z-index**
   - 为删除确认使用单独类名：`.confirm-delete-overlay`（全屏半透明蒙版）、`.confirm-delete-modal`（居中白底弹窗）。
   - 蒙版样式：`position: fixed; inset 全屏; background: rgba(0,0,0,0.5); z-index: 9999`，与主界面其它 modal 分离，避免被主布局的 stacking 影响。

2. **显示时把弹窗移到 body 末尾**
   - 在 `showConfirmDelete()` 中，在移除 `hidden` 之前执行：
     ```js
     document.body.appendChild(confirmDeleteModal);
     confirmDeleteModal.classList.remove('hidden');
     ```
   - 保证弹窗节点在 DOM 中处于 **body 的最后一个子节点**，从而在默认层叠顺序下处于最前，配合 z-index 稳定盖住整页。

3. **用 JS 绑定点击，不用 inline onclick**
   - 使用 `deleteBtn.addEventListener('click', showConfirmDelete)`，避免依赖全局 `window`，兼容 contextIsolation。

---

## 三、给产品经理的简要结论

| 项目 | 说明 |
|------|------|
| **问题** | 点击 Delete 后确认弹窗不显示，且没有报错提示。 |
| **根因** | 弹窗在页面结构里被其它界面层「盖住」了，属于前端层叠与 DOM 结构问题，不是业务逻辑错误。 |
| **解决** | 弹窗使用独立蒙版样式，并在每次打开时把弹窗节点移到页面最顶层（body 末尾），确保一定显示在最前面。 |
| **预防** | 以后新增「全局浮层/弹窗」时，优先采用：独立全屏蒙版 + 显示时 `appendChild` 到 `body` 末尾，避免类似问题。 |

---

## 四、相关文件与排查手段

- **实现位置**：`electron/src/renderer/index.html`（确认删除弹窗 HTML、样式、`showConfirmDelete` 与点击绑定）。
- **日志**：Main 进程将 renderer 的 `console.*` 写入 `electron/renderer-console.log`，便于在不依赖用户截图的情况下排查前端行为（见 `electron/src/main.js` 中 `webContents.on('console-message')`）。

---

*文档日期：2026-03*
