# 下载模式单选控件实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 将弹窗中的 checkbox 改为三个方形单选按钮（视频/音频/仅字幕），对应三种 MODE

**Architecture:** 前端 UI 改动，将 boolean 类型的 checkbox 改为 string 类型的 radio group

**Tech Stack:** Vanilla JavaScript, HTML, CSS

---

## 任务 1: 修改 HTML - checkbox 改为 radio 组

**Files:**
- Modify: `electron/src/renderer/index.html:1239-1243`

**Step 1: 替换 checkbox 为 radio 组**

将以下代码：
```html
<label class="checkbox-label">
  <input type="checkbox" id="modalVideoToggle" checked />
  <span class="checkbox-custom"></span>
  <span>下载视频</span>
</label>
```

替换为：
```html
<div class="radio-group" id="modalDownloadMode">
  <label class="radio-label">
    <input type="radio" name="downloadMode" value="video" checked />
    <span class="radio-custom"></span>
    <span>视频</span>
  </label>
  <label class="radio-label">
    <input type="radio" name="downloadMode" value="audio" />
    <span class="radio-custom"></span>
    <span>音频</span>
  </label>
  <label class="radio-label">
    <input type="radio" name="downloadMode" value="transcript" />
    <span class="radio-custom"></span>
    <span>仅字幕</span>
  </label>
</div>
```

**Step 2: 验证文件已修改**

Run: `grep -n "modalDownloadMode" electron/src/renderer/index.html`
Expected: 找到新增的 id="modalDownloadMode"

---

## 任务 2: 修改 CSS - 添加 radio 样式

**Files:**
- Modify: `electron/src/renderer/index.html` (在 `.checkbox-label` 样式后添加)

**Step 1: 添加 radio 样式**

在约第 364 行（checkbox 样式结束后）添加：
```css
    /* Radio Group */
    .radio-group {
      display: flex;
      gap: 16px;
      align-items: center;
    }

    .radio-label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 13px;
      color: var(--text);
    }

    .radio-label input[type="radio"] {
      display: none;
    }

    .radio-custom {
      width: 16px;
      height: 16px;
      border: 1px solid var(--border);
      background: var(--bg);
      position: relative;
      transition: all var(--transition);
    }

    .radio-label:hover .radio-custom {
      border-color: var(--accent);
    }

    .radio-label input[type="radio"]:checked + .radio-custom {
      background: var(--accent);
      border-color: var(--accent);
    }

    .radio-label input[type="radio"]:checked + .radio-custom::after {
      content: '';
      position: absolute;
      top: 3px;
      left: 5px;
      width: 4px;
      height: 8px;
      border: solid var(--bg);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
```

**Step 2: 验证样式已添加**

Run: `grep -n ".radio-group" electron/src/renderer/index.html`
Expected: 找到 `.radio-group {`

---

## 任务 3: 修改 JavaScript - 更新状态读写逻辑

**Files:**
- Modify: `electron/src/renderer/index.html`

**需要修改的位置：**

1. **变量声明（约第 1354 行）**
   - 将 `let modalDownloading = true;` 改为 `let modalDownloadMode = 'video';`

2. **读取 radio 值（约第 1363 行）**
   - 删除或注释原有的 checkbox change 事件监听
   - 添加新的 radio change 监听器

3. **加载任务时设置状态（约第 1409-1410 行）**
   - 将：
     ```javascript
     modalVideoToggle.checked = j.downloadVideo !== false;
     modalDownloading = j.downloadVideo !== false;
     ```
   - 改为：
     ```javascript
     const mode = j.downloadVideo || 'video';
     modalDownloadMode.querySelector(`input[value="${mode}"]`).checked = true;
     modalDownloadMode = mode;
     ```

4. **重置弹窗时设置默认值（约第 1454-1455 行）**
   - 将：
     ```javascript
     modalVideoToggle.checked = true;
     modalDownloading = true;
     ```
   - 改为：
     ```javascript
     modalDownloadMode.querySelector('input[value="video"]').checked = true;
     modalDownloadMode = 'video';
     ```

5. **保存任务时获取值（约第 1524 行）**
   - 将：
     ```javascript
     const downloadVideo = modalVideoToggle.checked;
     ```
   - 改为：
     ```javascript
     const downloadVideo = modalDownloadMode;
     ```

6. **保存到任务对象（约第 1533 行）**
   - 将：
     ```javascript
     j.downloadVideo = downloadVideo;
     ```
   - 保持不变（已经是字符串）

7. **运行任务时传递参数（约第 1657 行）**
   - 将：
     ```javascript
     downloadVideo: modalDownloading
     ```
   - 改为：
     ```javascript
     downloadVideo: modalDownloadMode
     ```

8. **状态显示逻辑（约第 1473 行）**
   - 将：
     ```javascript
     if (modalDownloading) {
     ```
   - 改为：
     ```javascript
     if (modalDownloadMode === 'video') {
     ```
   - 类似地修改第 1670、1674、1696、1707、1783、1787 行

**Step: 批量验证修改**

Run: `grep -n "modalDownloading\|modalDownloadMode\|downloadVideo" electron/src/renderer/index.html | head -30`
Expected: 所有相关变量都已改为 modalDownloadMode

---

## 任务 4: 测试验证

**Step 1: 启动 Electron 应用**

Run: `cd electron && npm start`

**Step 2: 验证 UI**
- 弹窗中应显示三个横向排列的方形单选按钮
- 默认选中"视频"
- 点击不同选项应有选中状态变化

**Step 3: 验证数据流**
- 选择"视频" → MODE=full_flow_video
- 选择"音频" → MODE=full_flow_audio
- 选择"仅字幕" → MODE=full_flow_transcript

---

## 任务 5: 提交代码

```bash
git add electron/src/renderer/index.html docs/plans/2026-03-06-download-mode-radio-design.md
git commit -m "feat: 将下载选项改为单选控件（视频/音频/仅字幕）"
```
