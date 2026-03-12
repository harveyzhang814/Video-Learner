# GUI 主面板信息区与 Article/Summary 布局优化实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将中间主面板重构为「InfoCard（标题+URL+状态）+ ContentCard（Article/Summary 功能栏+展示栏）」两块卡片，使信息展示更紧凑、状态条更清晰、Article/Summary 更像阅读器且内部独立滚动。

**Architecture:** 保持现有三栏布局与状态流不变，仅在 `electron/src/renderer/index.html` 中重排中间列 DOM 与 CSS：信息模块精简为 Title/URL，状态条抽成单独区块（上下分割线、统一缩小 pill 样式），Article/Summary 变为「上方 tab 按钮 + 下方 markdown 滚动区」的卡片结构，滚动仅在内容区内部发生。

**Tech Stack:** 纯前端（HTML/CSS/JS），基于现有手写布局 + `marked` 作为 Markdown 渲染器；不新增依赖。

---

### Task 1: 精简信息模块为 Title/URL

**Files:**
- Modify: `electron/src/renderer/index.html`（中间主面板 Info 区块所在部分）

**Step 1: 定位 Info 区 DOM**
- 在 `index.html` 中找到当前信息展示区域（包含 `infoTitle`、`infoUrl`、`infoLang`、`infoDuration`、`infoFocus` 等行）。
- 确认这些行周围的 `.info-row` / `.info-label` / `.info-value` 结构，以免破坏现有布局。

**Step 2: 删除多余字段行**
- 保留两行：
  - `Title` 行：绑定 `infoTitle`。
  - `URL` 行：绑定 `infoUrl`。
- 移除 `Lang`、`Duration`、`Focus` 等多余信息行的 HTML 片段。

**Step 3: 调整样式细节**
- 确保 Title 行采用当前字体大小或略大一档，URL 行字体稍小并使用 `var(--text-muted)` 颜色。
- 如果 URL 行存在 label（例如“URL”），可简化为只保留值，减少视觉噪声。

**Step 4: 验证**
- 启动 Electron GUI，打开已有任务：
  - 信息区只展示标题与 URL；其它字段不再出现。
  - 长 URL 在列宽内折行显示但不会撑破布局。

**Step 5: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): simplify info panel to title and URL only"
```

---

### Task 2: 抽离并缩小状态条（StatusBar）

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: DOM 抽离**
- 将中间主面板中渲染状态 pills 的容器（当前的 `.info-status` 或等价结构）从原信息区中抽离，重构为紧挨信息区下方的独立区块，例如：
  - `div` class=`info-status-bar`，内部仍包含 step pills。
- 确保状态条不与 Title/URL 混在同一块之内。

**Step 2: 添加上下分割线与内边距**
- 为新的状态条容器添加：
  - `border-top: 1px solid var(--border);`
  - `border-bottom: 1px solid var(--border);`
  - 垂直方向 padding 调小（例如 `4px 0` 或 `6px 0`）。

**Step 3: 缩小状态 pill 样式（主界面 + 弹窗统一）**
- 调整 `.status-pill` 相关 CSS：
  - 字号减小一级（例如从 `13px` → `11px`）。
  - 水平/垂直 padding 略减小、圆角略缩小。
  - icon 字体大小与宽度适配新的高度。
- 确保 Manage 弹窗中的状态条（`#modalStatus`）也复用同一套 `.status-pill` 样式，形成统一视觉密度。

**Step 4: 验证**
- 在主界面和 Manage 弹窗分别查看状态条：
  - 上下有清晰分割线。
  - pill 尺寸明显比之前更紧凑，但仍易读。
  - 各 step 状态颜色与运行逻辑不变（running/done/error）。

**Step 5: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): refactor status bar into compact standalone section"
```

---

### Task 3: 重构 Article/Summary 卡片结构（功能栏 + 展示栏）

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 调整 DOM 结构**
- 在中间主面板中，将原有 Article/Summary 区块重组为两部分：
  - `ContentCard` Header：一个容器内仅包含 Article / Summary 切换按钮。
  - `ContentCard` Body：包裹 `articleOutput` / `summaryOutput` 的内容区域。
- 去掉原本的大灰色外层卡片背景，保留基础结构以便 JS 中的 `articleOutput` / `summaryOutput` 绑定不变。

**Step 2: 功能栏样式（Header）**
- 将现有 `.tab` 按钮收紧：
  - 减小高度与 padding，使其更像小 tab。
  - active 状态：加底部边线或背景块，非 active 为浅灰。
- Header 底部添加一条 1px 分隔线，与 Body 分离。

**Step 3: 展示栏样式（Body）**
- 设置 ContentCard Body 的外层容器：
  - `padding: 0;`
  - 高度占据中间列剩余空间（可通过 flex 或固定高度），`overflow-y: auto`。
- 保留内部 `.markdown-content` 组件，并让其负责段落间距（无需额外灰色底与大卡片 padding）。

**Step 4: Markdown 渲染行为确认**
- 确认当前 JS 中使用 `marked` 渲染 Markdown（在 `selectTask` 中），并确保 Article/Summary 切换时：
  - `articleOutput` / `summaryOutput` 使用 `innerHTML = marked.parse(...)`（或项目统一的方法）。
  - 切换 tab 时重置展示栏滚动位置到顶部。

**Step 5: 验证**
- 在 GUI 中切换 Article / Summary：
  - 上侧为紧凑 tab 栏，下方为内容区，内容区内部单独滚动。
  - 外层不再有多余灰色背景卡片，整体看起来更像阅读器区域。

**Step 6: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): refactor article/summary into header+scrollable body card"
```

---

### Task 4: 对齐状态条与 Article/Summary 的交互细节

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 校验状态条与 steps 状态映射**
- 重新梳理 `applyTaskToInfo(task)` 中对 `STEPS` 与 UI 状态的映射逻辑，确保抽出后的状态条仍正常更新。
- 若必要，可将 InfoCard 和状态条的 DOM 更新逻辑适度拆分函数（例如 `renderStatusBar(steps)`），但避免过度重构。

**Step 2: Tab 与内容一致性**
- 确保 Article / Summary tab active 状态与当前展示内容同步：
  - 初始选项为 Article。
  - 切换 tab 时只更新展示栏内容与 active class，不影响任务状态。

**Step 3: 验证**
- 多选几个任务（含/不含 article/summary 的），点击切换 Article/Summary、查看状态条：
  - 状态条与任务步骤一致。
  - Article/Summary 内容与 tab 状态一致，滚动行为符合预期。

**Step 4: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "chore(gui): align info/status rendering with new article/summary card layout"
```

---

### 执行与回归

- 推荐每完成 1–2 个 Task 后运行一次：

```bash
npm run test:gui
```

- 人工回归重点：
  - 信息区仅 Title/URL 显示正确，长 URL 时不破坏布局。
  - 状态条在主界面和 Manage 弹窗内样式统一、体积缩小且状态正确。
  - Article/Summary 卡片的切换与滚动体验符合预期，Markdown 渲染正常无多余灰底。

