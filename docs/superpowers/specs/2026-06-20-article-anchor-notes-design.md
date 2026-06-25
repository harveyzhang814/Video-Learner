# Article Anchor Notes 设计文档

## 概述

为笔记系统添加文章锚点绑定能力：用户在文章中划选一段文字，点击气泡后跳转到笔记输入框并创建一条绑定到该文字的笔记。笔记卡片在右侧 notes-col 中以绝对定位方式呈现，视觉上与锚点文字在文章中的 Y 位置对齐。

## 背景

当前笔记系统（`notes-panel.tsx`）支持自由输入和媒体时间戳绑定，但笔记列表与文章内容之间没有空间对应关系，用户无法直观地看出哪条笔记对应文章的哪个位置。本设计通过位置对齐建立视觉关联，无需显示引用文字。

## 用户故事

1. 用户在文章中拖选一段文字，选区右上角出现小气泡
2. 点击气泡后，notes-col 输入框获得焦点，准备记录
3. 用户输入笔记内容，⌘↵ 提交
4. 笔记卡片出现在 notes-col 中，与选中文字在文章中的 Y 位置对齐
5. 无锚点的笔记（纯媒体时间戳或自由输入）堆叠在 notes-col 顶部

## 触发与气泡 UI

- 在 `reader.tsx` 的 `.article-col` 上监听 `mouseup`
- 判断 `window.getSelection()` 是否有非空选区且在文章内部
- 气泡用 `position: fixed`，坐标取 `selection.getRangeAt(0).getBoundingClientRect()` 右上角
- 气泡只有一个操作（📝 记笔记），无二级菜单
- 点击气泡：
  1. 将选中文字前 80 字符存入 `pendingAnchor` 状态
  2. 清除选区
  3. 聚焦 notes-col 输入框
- 在其他地方 `mousedown` 或按 Esc 时气泡消失

## Anchor 存储格式

`Note.anchor` 字段存选中文字的前 80 个字符（已在 `api.ts` 和后端中存在，无需后端改动）：

```json
{
  "id": "abc123",
  "anchor": "这是文章中被选中的那段文字的前80个字符…",
  "body": "用户写的笔记内容",
  "createdAt": 1718900000000,
  "updatedAt": 1718900000000
}
```

无锚点笔记的 `anchor` 保持 `''`。

## Y 位置计算

每次渲染时，对每条 `anchor !== ''` 的笔记：

1. 用 `TreeWalker` 遍历 `.article-col` 内所有文本节点，找到第一个包含 `anchor` 字符串的节点
2. 从该文本节点向上找最近的块级祖先（`p`、`h1`~`h3`、`li`、`blockquote`）
3. 计算相对于 article-col 顶部的绝对偏移：
   ```
   top = element.getBoundingClientRect().top
       - articleCol.getBoundingClientRect().top
       + articleCol.scrollTop
   ```
4. 该值作为笔记卡片的 `top` 属性

找不到对应文字时（文章内容变化），该笔记降级为无锚点，归入顶部列表，显示警告图标。

## Notes-col 布局改造

`notes-col` 与 `article-col` 必须共享同一滚动容器（`article-notes-row`），确保坐标系一致。`notes-col` 自身不能有 `overflow-y: auto`。

内部结构：

```
notes-col (position: relative, overflow: visible)
  ├── 输入区（position: sticky; top: 0; z-index: 10）
  │     ├── textarea（⌘↵ 提交）
  │     └── 当前锚点预览（有 pendingAnchor 时显示）
  ├── 无锚点笔记区（普通流式列表）
  └── 锚点笔记区（position: relative; height: articleHeight）
        └── NoteCard（position: absolute; top: <计算后Y>px）
```

锚点笔记区高度设为 `articleCol.scrollHeight`，通过 `ResizeObserver` 同步，保证滚动容器能完整滚动。

## 碰撞处理（向下推挤）

锚点 Y 计算完成后，执行推挤：

```
GAP = 8   // px
cursor = 0
for each note in sortedByAnchorY:
  note.top = max(note.anchorY, cursor)
  cursor = note.top + note.height + GAP
```

- `note.height` 通过 `ResizeObserver` 测量实际渲染高度；初次渲染前估算为 72px
- 在 `useLayoutEffect` 中同步执行，避免视觉闪烁
- 文章滚动时不重新计算（Y 偏移是绝对值）
- 文章内容刷新时重新定位并重跑推挤算法

## 改动范围

| 文件 | 改动说明 |
|---|---|
| `web/src/routes/tasks.$id.tsx` | 将 `articleRef` 传给 `NotesPanel`；`article-notes-row` 取消独立滚动 |
| `web/src/components/notes-panel.tsx` | 拆分无锚/有锚区域；绝对定位逻辑；推挤算法；sticky 输入框；接收 `pendingAnchor` prop |
| `web/src/components/reader.tsx` | 添加 `mouseup` 选区监听；渲染气泡；管理 `pendingAnchor` 状态并传给 `NotesPanel` |
| `web/src/styles/globals.css` | `notes-col` 去掉 `overflow-y: auto` |
| `web/src/lib/api.ts` | 无需改动（`anchor` 字段已存在） |
| `services/http-server/index.js` | 无需改动（已透传 `anchor`） |

## 不涉及范围

- 后端存储逻辑
- Mode A/B/C/F（这些模式下 notes-col 不可见，改动无影响）
- 媒体时间戳绑定逻辑（保持不变）
- 现有测试（http-notes、e2e-notes 测试逻辑不受影响）

## 测试策略

- **单元层**：推挤算法（纯函数）单独测试，覆盖：无碰撞、两张卡片碰撞、链式碰撞、找不到 anchor 降级
- **E2E**：扩展现有 `e2e-notes.test.js`，添加：选区 → 气泡出现 → 点击 → 提交后卡片 Y 位置与文章段落对齐（允许 ±4px 误差）
