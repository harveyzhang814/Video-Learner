# 删除确认弹窗优化设计

## 背景

当前删除任务时使用浏览器原生 `confirm()` 函数，样式与项目风格不统一。同时删除后播放界面停留在空状态，用户体验不佳。

## 设计方案

### 1. 删除确认弹窗

复用现有 modal 组件样式，创建简化版确认对话框：

- **标题**: "确认删除"
- **内容**: "确定要删除这个任务及其所有文件吗？此操作不可撤销。"
- **按钮**:
  - 左侧: "取消" (默认灰色 `.btn`)
  - 右侧: "删除" (红色 `.btn.danger`)

```html
<div class="modal-overlay hidden" id="confirmDeleteModal">
  <div class="modal" style="width: 400px;">
    <div class="modal-content">
      <div class="modal-title">确认删除</div>
      <p style="color: var(--text-muted); margin: 0;">确定要删除这个任务及其所有文件吗？此操作不可撤销。</p>
      <div class="modal-actions" style="justify-content: flex-end; margin-top: 16px;">
        <button class="btn" id="confirmDeleteCancel">取消</button>
        <button class="btn danger" id="confirmDeleteOk">删除</button>
      </div>
    </div>
  </div>
</div>
```

### 2. 删除后播放界面刷新

删除成功后：
- 如果列表中还有其他项目 → 自动选中**最后一个项目**并加载
- 如果列表为空 → 显示空状态

## 实现要点

1. 在 index.html 中添加确认弹窗 HTML
2. 修改 deleteBtn 的事件处理逻辑
3. 在 loadHistory 之后检查是否有 remaining works，如果有则自动加载最后一个
