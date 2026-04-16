# 删除确认弹窗实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将浏览器原生 confirm() 替换为项目风格的确认弹窗，并优化删除后的导航逻辑

**Architecture:** 在 index.html 中添加确认弹窗 HTML，修改 deleteBtn 事件处理逻辑

**Tech Stack:** Vanilla JavaScript, HTML, CSS (现有项目风格)

---

### Task 1: 添加确认弹窗 HTML

**Files:**
- Modify: `electron/src/renderer/index.html:1395` (在 newTaskModal 之后)

**Step 1: 添加确认弹窗 HTML**

在 `</div><!-- newTaskModal -->` 后添加:

```html
<!-- Confirm Delete Modal -->
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

**Step 2: 添加 confirmDeleteModal 变量引用**

在 `const modalCloseBtn = ...` 附近 (line 1573) 添加:

```javascript
const confirmDeleteModal = document.getElementById('confirmDeleteModal');
const confirmDeleteCancel = document.getElementById('confirmDeleteCancel');
const confirmDeleteOk = document.getElementById('confirmDeleteOk');
```

**Step 3: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: add confirm delete modal HTML"
```

---

### Task 2: 实现确认弹窗显示/隐藏逻辑

**Files:**
- Modify: `electron/src/renderer/index.html` (在 modal 相关函数附近添加)

**Step 1: 添加 showConfirmDelete / hideConfirmDelete 函数**

在 `closeNewTaskModal` 函数后添加:

```javascript
function showConfirmDelete() {
  confirmDeleteModal.classList.remove('hidden');
}

function hideConfirmDelete() {
  confirmDeleteModal.classList.add('hidden');
}
```

**Step 2: 添加取消按钮事件**

在文件末尾 `</script>` 前添加:

```javascript
confirmDeleteCancel.addEventListener('click', hideConfirmDelete);
confirmDeleteModal.addEventListener('click', (e) => {
  if (e.target === confirmDeleteModal) hideConfirmDelete();
});
```

**Step 3: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat: add confirm modal show/hide functions"
```

---

### Task 3: 修改删除按钮逻辑

**Files:**
- Modify: `electron/src/renderer/index.html:2493-2520`

**Step 1: 修改 deleteBtn 事件处理**

将现有的:
```javascript
deleteBtn.addEventListener('click', async () => {
  if (!currentId) return;
  if (confirm('Delete this item and all its files?')) {
    // ... 删除逻辑
  }
});
```

改为:
```javascript
deleteBtn.addEventListener('click', async () => {
  if (!currentId) return;
  showConfirmDelete();
});

confirmDeleteOk.addEventListener('click', async () => {
  hideConfirmDelete();
  if (!currentId) return;

  await window.api.deleteWork(currentId);
  const works = await window.api.listWorks();

  currentId = null;
  toolbar.classList.add('hidden');
  urlInput.value = '';
  focusInput.value = '';
  articleOutput.innerHTML = '';
  summaryOutput.innerHTML = '';
  emptyState.classList.remove('hidden');
  videoPlayer.pause();
  videoPlayer.src = '';
  hideVideo();
  loadHistory();

  // 尝试加载最后一个项目
  if (works.length > 0) {
    const lastWork = works[works.length - 1];
    await loadWork(lastWork.id);
  } else {
    // 重置 info section
    infoEmpty.classList.remove('hidden');
    infoContent.classList.add('hidden');
    infoTitle.textContent = '-';
    infoUrl.textContent = '-';
    infoLang.textContent = '-';
    infoDuration.textContent = '-';
    infoFocus.textContent = '-';
    resetInfoStatusPills();
  }
});
```

**Step 2: Commit**

```bash
git add electron/src/renderer/index.html
git commit -f ix/delete-confirm-dialog
git commit -m "feat: use custom confirm dialog and auto-select next item after delete"
```

---

### Task 4: 测试验证

**Step 1: 启动 Electron 应用**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner && bash start-electron.sh
```

**Step 2: 测试场景**

1. 创建一个新任务
2. 点击 Delete 按钮
3. 验证弹窗样式是否为项目风格（不是浏览器原生 confirm）
4. 点击"取消" - 验证弹窗关闭，任务未被删除
5. 再次点击 Delete，点击"删除"
6. 验证：
   - 任务被删除
   - 如果有其他任务，自动选中最后一个并显示其内容
   - 如果没有其他任务，显示空状态

**Step 3: Commit**

```bash
git commit --allow-empty -m "test: verify delete confirm dialog works"
```
