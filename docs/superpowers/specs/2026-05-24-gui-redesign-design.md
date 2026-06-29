---
migrated: 2026-06-29
superseded_by:
  - 2026-06-16-electron-to-web-migration-design.md  # 整体 UI 架构已被 Web 迁移方案取代
  - 2026-06-20-reading-modes-design.md              # 多模式布局被 Reading Modes 重新设计
implemented_in:
  - web/src/  # 整体已在 Web 前端实现
---

# GUI Redesign — Design Spec

**Date:** 2026-05-24  
**Branch:** feature/app-icon → will be a new feature branch  
**Mockup:** `~/.gstack/projects/harveyzhang814-Video-Learner/designs/gui-redesign-20260524/finalized.html`

---

## 1. 目标

优化 Electron 渲染器 (`electron/src/renderer/index.html`) 的 UI，将三栏布局重构为职责更清晰的分区：中间面板专注内容阅读，右侧边栏承载播放器与任务元信息。

---

## 2. 布局总览

```
┌─────────────────────────────────────────────────────────────────┐
│  左侧列表栏 220px  │  中间内容区 flex-1  │  右侧面板 380px      │
│  ─────────────────  ─────────────────────  ──────────────────── │
│  Logo     + New    │  工具栏              │  [播放]  [信息]      │
│  ─────────────────  ─────────────────────  ──────────────────── │
│  🔍 搜索框         │  [Article][Summary]  │  播放 tab:           │
│  ─────────────────  ─────────────────────  │  视频容器           │
│  任务卡片列表       │  正文滚动区          │  播放控制            │
│  · 标题（行1）      │  （Markdown 渲染）   │  字幕列表            │
│  · 时间   ●状态    │                      │                      │
│  · 标题             │                      │  信息 tab:           │
│  · 时间   ●状态    │                      │  视频信息            │
│  · ...              │                      │  任务配置            │
│                     │                      │  处理进度（pills）   │
│                     │                      │  时间戳              │
│                     │                      │  TODO（待存 DB）     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 变更清单

### 3.1 左侧列表栏

| 项目 | 变更 |
|------|------|
| 搜索 | Header 下方新增搜索输入框，`input` 事件实时过滤 `.history-item`（匹配 `.title` 文本） |
| 卡片布局 | 第一行：标题（`font-size: 12px`，`text-overflow: ellipsis`）；第二行：左时间戳 + 右状态圆点 |
| 状态圆点 | 从 `.meta` 左侧移至右侧，与时间戳 `justify-content: space-between` |
| 字体 | 整体缩小：标题 13px → 12px，meta 11px → 10px，sidebar-width 240px → 220px |

### 3.2 中间内容区

| 项目 | 变更 |
|------|------|
| 移除 | Info Section（标题/URL/语言/关注点）从中间面板移走 |
| 移除 | Status Bar（8 步 pills）从中间面板底部移走 |
| 保留 | 工具栏（Open/Delete/中止/继续/Manage） |
| 保留 | Article / Summary tab + 正文滚动区 |
| 结果 | 中间面板职责单一：只展示内容 |

### 3.3 右侧面板

**新增 Tab Strip：**

| Tab | 内容 |
|-----|------|
| 播放 | 现有视频容器 + 播放控制 + 字幕模块（不变） |
| 信息 | 视频信息 + 任务配置 + 处理进度 + 时间戳 + TODO 区块 |

**信息 Tab 字段清单：**

```
视频信息
  标题        task.title
  创作者      task.uploader          ← 新增展示（DB 已有）
  URL         task.url
  时长        task.duration（格式化为 mm:ss）

任务配置
  输出语言    task.output_lang
  模式        task.mode
  关注点      task.focus

处理进度（8 步 pills）
  fetch / video / audio / subs / vtt2md / md2vtt / article / summary
  状态色：pending(灰) / running(黄,pulse) / completed(绿) / failed(红)

时间戳
  创建        task.created_at
  更新        task.updated_at

TODO（灰底占位，待后续存入 DB）
  发布日期    upload_date
  播放量      view_count
  点赞数      like_count
  视频简介    description
  封面缩略图  thumbnail
  分辨率/帧率 width · height · fps
```

---

## 4. 受影响文件

| 文件 | 改动类型 |
|------|---------|
| `electron/src/renderer/index.html` | 主要改动：CSS + DOM 结构重写 |
| `electron/src/renderer/ui-state.js` | 检查是否需要新增 `uploader` 字段映射 |
| `electron/src/renderer/client-state.js` | 检查 task 事件中 `uploader` 是否已透传 |

JS 逻辑（SSE 事件处理、tab 切换、search filter）均在 `index.html` 内联，改动范围自包含。

---

## 5. 不在本次范围内

- 后端 / DB schema 无需改动（`uploader` 已存在）
- yt-dlp 额外字段（`upload_date` 等）存 DB：单独任务
- 功能逻辑变更（任务创建、abort、resume 等）：不动

---

## 6. 测试要点

- `npm run test:gui` 通过（Electron 主进程 + preload 无破坏）
- 手动验证：搜索过滤、tab 切换、状态圆点位置、信息 tab 各字段正确渲染
- 现有 JS 变量/ID 引用（`#infoTitle`、`#infoUrl` 等）需在重构后保持兼容或同步更新
