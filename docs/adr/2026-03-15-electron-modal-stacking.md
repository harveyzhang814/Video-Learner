# ADR: Electron 全局弹窗层叠稳定性方案

**日期**: 2026-03-15
**状态**: accepted

## 背景

在 Electron/Chromium 环境下，将确认删除弹窗（蒙版 + 居中弹窗）挂在 `.app` 的兄弟节点时，点击触发后弹窗不出现，且控制台无报错。

根因：DOM 顺序与 stacking context 导致后渲染的 overlay 仍被主布局层遮挡，即使设置了较高 `z-index`（如 9999）依然不可见。此外，历史实现中使用 `onclick="window.showDeleteConfirm()"` 的 inline 回调，在 `contextIsolation: true` 下会因 `window` 引用不一致导致点击无响应。

## 决策

全局浮层（弹窗/蒙版）统一采用以下模式：

1. **独立蒙版 + 高 z-index**：使用独立类名（如 `.confirm-delete-overlay`），样式为 `position: fixed; inset 全屏; background: rgba(0,0,0,0.5); z-index: 9999`，与主界面其它 modal 分离。

2. **显示时把弹窗移到 body 末尾**：在 show 函数中，移除 `hidden` 之前执行：
   ```js
   document.body.appendChild(modal);
   modal.classList.remove('hidden');
   ```
   保证弹窗节点在 DOM 中处于 **body 的最后一个子节点**，在默认层叠顺序下处于最前。

3. **用 JS 绑定点击，不用 inline onclick**：使用 `element.addEventListener('click', handler)`，避免依赖全局 `window`，兼容 `contextIsolation: true`。

## 理由

- `appendChild` 到 body 末尾是最简单可靠的方式，不依赖 CSS stacking context 细节
- 不修改现有组件结构，对已有逻辑无侵入
- inline onclick 在 contextIsolation 下有已知风险，addEventListener 是标准做法

## 影响

- 所有全局浮层（删除确认、重试确认等）均按此模式实现
- 新增弹窗时需遵循此约定，见 [reference/design-system.md](../reference/design-system.md)
- 实现位置：`electron/src/renderer/index.html`
