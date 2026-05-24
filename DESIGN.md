# DESIGN.md — Video Learner GUI

> 单一设计规范文档，覆盖界面目标、设计令牌、组件规范、屏幕清单与交互流程。
> 实现入口：`electron/src/renderer/index.html`

---

## 一、界面目标

| 目标 | 说明 |
|---|---|
| **零学习曲线** | 粘贴 URL → 点运行，无需了解后台流水线细节 |
| **进度透明** | 8 步流水线实时可见，失败步骤可单步重试 |
| **内容优先** | 文章/摘要占最大面积；视频播放、字幕、元信息在右侧按需查看 |
| **视觉风格** | Swiss Minimal — 黑白灰、直角、无装饰、8px 栅格 |

---

## 二、设计令牌

所有 CSS 自定义属性定义在 `:root`，禁止在组件内写死色值（危险按钮红色除外）。

### 颜色

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `#FFFFFF` | 主背景（卡片、弹窗） |
| `--bg-alt` | `#FAFAFA` | 页面底衬、只读区域 |
| `--bg-hover` | `#F5F5F5` | 可交互元素 hover 背景 |
| `--text` | `#111111` | 主文字 |
| `--text-secondary` | `#666666` | 次要文字 |
| `--text-muted` | `#999999` | 辅助/说明/占位文字 |
| `--border` | `#E5E5E5` | 分割线、描边 |
| `--accent` | `#000000` | 强调色、主按钮、焦点、active 指示 |

**语义色（status pill 专用，暂未提取为 token）：**

| 状态 | 背景 | 文字 | 边框 |
|---|---|---|---|
| done | `#f0fdf4` | `#16a34a` | `#86efac` |
| error | `#fef2f2` | `#dc2626` | `#fca5a5` |
| 危险按钮 | `#DD0000` | `#FFFFFF` | `#DD0000` |

### 尺寸与间距

| 令牌 | 值 | 用途 |
|---|---|---|
| `--grid-unit` | `8px` | 所有 padding/margin 的基准，使用 `calc(var(--grid-unit) * N)` |
| `--radius` | `0px` | 全局圆角（Swiss Minimal 直角原则，无例外） |
| `--transition` | `0.15s ease` | 所有交互动效时长 |

### 字体

- **字体族**：Inter（本地 woff2，400 / 500 / 600），系统回退 `-apple-system, BlinkMacSystemFont, 'Segoe UI'`
- **字体文件**：`electron/src/renderer/fonts/inter-latin-{400,500,600}-normal.woff2`
- **正文**：14px，`line-height: 1.5`
- **强调/标题**：`font-weight: 600`，14px（不超过 14px）
- **小标签**：11px，`text-transform: uppercase`，`letter-spacing: 0.05em`
- **代码/时间戳**：`'SF Mono', 'Monaco', monospace`，12–13px

---

## 三、组件规范

### 按钮（`.btn`）

- 直角（`--radius: 0px`），1px 描边，`padding: 10px 20px`
- hover：`border-color` 变为 `--accent`
- 主按钮 `.btn.primary`：黑底白字（`--accent` 背景），hover `#333`
- 危险按钮 `.btn.danger`：`#DD0000` 背景白字，hover `#BB0000`，`border-color: #DD0000`
- 禁用：`opacity: 0.5`，`cursor: not-allowed`
- 工具栏尺寸：`font-size: 12px`，`padding: 8px 16px`

### 单选（`.radio-label` + `.radio-custom`）

- 原生 `<input>` 隐藏，用 `.radio-custom`（16×16px 方形）替代
- hover：`background: var(--bg-hover)`，`border-color: var(--accent)`
- 选中：黑色填充，白色对勾标记

### 复选框（`.checkbox-label` + `.checkbox-custom`）

- 同单选方案，16×16px 方形，选中时黑底白对勾

### 切换开关（`.toggle`）

- 36×20px 胶囊形，激活时 `background: var(--accent)`，滑块右移 16px

### 输入框（`.input-field`）

- `padding: 10px 12px`，1px 描边，focus 时 `border-color: var(--accent)`
- placeholder 颜色：`--text-muted`

### 标签页（`.tabs` / `.tab`）

- 容器：`background: var(--bg-alt)`，`border-radius: var(--radius)`，内边距 2px
- 单个 tab：`padding: 4px 10px`，`font-size: 11px`，active 时黑底白字
- ARIA：`role="tablist"` / `role="tab"` / `aria-selected` / `role="tabpanel"`

### Status Pill（`.status-pill`）

- 圆角胶囊（`border-radius: 10px`，semantic 例外）
- 4 种状态：默认（灰）/ `active`（旋转图标 ◐，黑色边框）/ `done`（绿色）/ `error`（红色，可点击时加 `.clickable`）

### 弹窗（`.modal-overlay` + `.modal`）

- 蒙版：`position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000`
- 弹窗体：白底，`1px solid var(--border)`，无圆角，无阴影，`width: 600px`
- 弹窗节点必须在 `<body>` 末尾（显示前 `document.body.appendChild(modal)`），避免 stacking context 问题
- 小型确认弹窗（`.confirm-delete-modal`）：`width: 420px`

### 弹窗实现原则

1. 所有色值、间距使用 token，不写死（危险按钮除外）
2. 内部 padding/gap 为 `--grid-unit` 的整数倍
3. 标题使用 `.modal-title`，按钮区用 `.modal-actions`
4. 新增全局浮层时显示前 `document.body.appendChild(el)`，见 [adr/2026-03-15-electron-modal-stacking.md](docs/adr/2026-03-15-electron-modal-stacking.md)

### 滚动条

- `width: 6px`，`background: #CCC`，透明轨道

---

## 四、整体布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  侧栏 220px  │        主内容区 flex:1         │▕│  视频面板 400px     │
│              │                                │ │                    │
│  ┌──────────┐│  工具栏（打开/删除/管理/中止）  │ │  [播放] [信息]      │
│  │ 任务历史 ││  ──────────────────────────── │ │                    │
│  │  列表    ││  [文章] [摘要] 内容标签栏      │ │  视频容器           │
│  │          ││  进度条（处理中时显示）         │ │  播放控制栏         │
│  │          ││  ──────────────────────────── │ │  ━━━ 分割线 ━━━    │
│  │          ││                               │ │  字幕列表           │
│  │          ││  文章 / 摘要 内容区             │ │                    │
│  └──────────┘│                               │ │  （或信息面板）     │
└──────────────────────────────────────────────────────────────────────┘
```

**尺寸约束：**

| 区域 | 默认 | 拖拽范围 |
|---|---|---|
| 侧栏 | 220px（固定） | — |
| 视频面板宽度 | 400px | 260–720px（横向拖拽 `#resizer`） |
| 视频容器高度 | 225px | 160–480px（纵向拖拽 `#videoResizer`） |

视频容器高度随面板宽度自动保持视频原始宽高比（`videoHeight / videoWidth`，默认 9:16）。

---

## 五、屏幕与 UI 状态

### 5.1 空状态（无任务选中）

**触发条件：** 首次启动 / 历史列表为空 / 未选中任务

| 区域 | 显示内容 |
|---|---|
| 工具栏 | 隐藏 |
| 文章面板 | `#emptyState`：「输入 YouTube 链接开始」 |
| 摘要面板 | `#summaryEmptyState`：「选择已完成的任务查看摘要」 |
| 视频面板 | `#videoEmpty`：▶ 暂无视频 |

**进入方式：** 点击「+ New」打开新建弹窗

---

### 5.2 任务选中

**触发条件：** 点击侧栏任意任务条目

| 区域 | 显示内容 |
|---|---|
| 侧栏条目 | 高亮（左边框 2px `--accent`，背景 `--bg-alt`） |
| 工具栏 | 显示「打开 / 删除 / 管理」 |
| 文章面板 | 渲染 Markdown；未生成时「文章尚未生成（或读取失败）」 |
| 摘要面板 | 渲染 Markdown；未生成时「总结尚未生成（或读取失败）」 |
| 视频容器 | 加载本地文件；无媒体文件时 `#videoEmpty` |
| 字幕区 | 有字幕轨时显示，否则隐藏 |
| 信息面板 | 标题、创作者、URL、时长、语言、关注点、步骤状态、时间戳 |

**内容加载顺序：**
1. `GET /tasks/:id` → 信息面板 + 工具栏
2. `GET /tasks/:id/content/article` + `/summary` → Markdown 渲染
3. `GET /tasks/:id/media` → 视频/音频
4. `GET /tasks/:id/subtitles` → 字幕列表

---

### 5.3 任务运行中

附加于「任务选中」状态之上。

| UI 元素 | 状态 |
|---|---|
| `#progressSection` | 显示 |
| `#progressFill` | 宽度按完成步骤比例更新 |
| `.progress-step` | `active`（脉冲点）/ `done`（实心点）/ 默认（空心点） |
| 工具栏「中止」 | 显示（红色危险按钮） |
| 侧栏状态点 | 黄色 |
| 信息面板 status pill | `active` ◐ / `done` ✓ / `error` ✗（可点击重试） |

**8 步流水线：**

| `data-step` | 显示名 | 说明 |
|---|---|---|
| `fetch` | 获取 | yt-dlp 获取视频元信息 |
| `video` | 视频 | 下载视频文件 |
| `audio` | 音频 | 下载音频文件 |
| `subs` | 字幕 | 下载字幕轨 |
| `vtt2md` | 转文案 | VTT → Markdown |
| `md2vtt` | 字幕生成 | Markdown → 带时间戳 VTT |
| `article` | 文章 | LLM 生成文章 |
| `summary` | 摘要 | LLM 生成摘要 |

---

### 5.4 视频播放器（「播放」tab）

| 元素 | 行为 |
|---|---|
| 视频容器 | 黑色背景；无视频时 `#videoEmpty` |
| 播放/暂停 | 播放时 ⏸ / 暂停时 ▶；`aria-label` 同步更新（「播放」/「暂停」） |
| 停止 | 暂停并跳回 0:00 |
| 进度条 `range` | 拖拽跳转，`timeupdate` 实时更新 |
| 时间显示 | `m:ss / m:ss`（超 1 小时：`h:mm:ss`） |
| `#videoResizer` | 纵向拖拽调整视频高度与字幕区分配 |

**字幕区（`#subtitleModule`，有字幕时显示）：**
- ≤ 2 条轨：语言切换按钮
- > 2 条轨：降级为 `<select>`
- 点击字幕条目：跳转到该时间点并播放
- 当前播放字幕高亮（黑底白字），自动滚入视图
- 「画面内字幕」复选框：切换视频内嵌 TextTrack

---

### 5.5 信息面板（「信息」tab）

| 字段组 | 字段 |
|---|---|
| 视频信息 | 标题、创作者、URL、时长 |
| 任务配置 | 输出语言、关注点 |
| 处理进度 | 8 步 status pill |
| 时间 | 创建时间、更新时间 |

status pill 状态为 `error` 时变为可点击，hover 显示「重试」提示，点击打开重试弹窗。

---

## 六、弹窗清单

### 6.1 新建任务（`#newTaskModal`，`data-mode="new"`）

**打开方式：** 侧栏「+ New」

| 字段 | 说明 |
|---|---|
| URL | YouTube 链接，必填 |
| 关注点 | 自由文本，可选 |
| 资源类型 | 单选：视频 / 音频 / 仅字幕（`mode: video/audio/transcript`） |

底部：「运行」主按钮 → status pill 实时更新 → SSE 日志流（`#modalLogs`）

---

### 6.2 管理任务（`#newTaskModal`，`data-mode="edit"`）

**打开方式：** 工具栏「管理」

复用同一 modal，区别：标题「管理任务」；URL/关注点只读；「运行」隐藏；运行中时显示「■ 停止任务」；日志面板显示历史日志。

---

### 6.3 删除确认（`#confirmDeleteModal`）

**打开方式：** 工具栏「删除」

| 模式 | 说明 |
|---|---|
| 硬删除（默认） | 删除记录 + 磁盘文件，**不可恢复** |
| 仅删记录 | 仅删数据库记录，保留文件 |
| 标记删除 | 列表隐藏，不删记录与文件 |

---

### 6.4 重试步骤（`#retryConfirmModal`）

**打开方式：** 点击 `error` 状态的 status pill

两阶段：确认（标题 + 「自动执行后续步骤」复选框）→ 运行（SSE 日志流）

---

### 6.5 重置步骤（`#resetPopup`）

> ⚠️ DOM 已实现，JavaScript 连接待完成，功能暂未激活

预期行为：重置步骤状态，允许重新执行（区别于重试：重置清除历史记录）。

---

## 七、侧栏交互

- 历史列表按 `created_at` 倒序，最多 200 条
- 状态点：🟡 running · 🟢 completed · 🔴 failed · 🟠 aborted · ⚫ unknown
- 搜索实时过滤（大小写不敏感），匹配标题
- SSE 推送状态变化，列表防抖刷新（400ms）
- 活跃条目：左边框 2px `--accent`

---

## 八、工具栏按钮规则

| 按钮 | 显示条件 |
|---|---|
| 打开 | 始终显示 |
| 删除 | 始终显示 |
| 管理 | 始终显示 |
| 中止 | 仅 `status === 'running'` |
| 继续 | 仅 `status === 'aborted'` |

工具栏整体：空状态隐藏，选中任务后显示。

---

## 九、无障碍

- 视频控制按钮有 `aria-label`（播放/暂停时动态更新）
- Tab strip：`role="tablist/tab/tabpanel"` + `aria-selected`
- 弹窗关闭按钮：`aria-label="关闭"`
- 视频进度条：`aria-label="视频进度"`
- `<html lang="zh-CN">`

---

## 十、Roadmap

| 项目 | 说明 |
|---|---|
| 信息面板扩展字段 | 发布日期、播放量、点赞数、视频简介、封面、分辨率/帧率，见 [`docs/reference/info-pane-roadmap.md`](docs/reference/info-pane-roadmap.md) |
| 重置步骤弹窗 JS | `#resetPopup` DOM 已就绪，需连接事件处理逻辑 |
| 深色模式 | 当前仅定义浅色 token |
| 面板尺寸持久化 | 拖拽后宽度/高度不跨会话保存 |
