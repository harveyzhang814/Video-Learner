## GUI 主界面信息区与 Article/Summary 布局优化设计（方案 2）

> 目标：让中间主面板的信息展示更紧凑清晰（只保留标题/URL + 独立状态条），同时让 Article/Summary 区块更像「阅读器卡片」——上方是功能栏（切换按钮），下方是独立滚动的 Markdown 展示区。

---

### 1. 中间列整体结构

- 现有中间列保持「上信息、下内容」的纵向分布，但显式抽象出两个主卡片：
  - **InfoCard**：信息 + 状态卡片
  - **ContentCard**：Article/Summary 内容卡片
- 结构示意：

```text
.main-column
  InfoCard
    Header: Title + URL
    Divider
    StatusBar: step pills（缩小版）

  ContentCard
    Header: Article / Summary 切换按钮
    Body: Markdown 展示区（overflow-y: auto）
```

---

### 2. 信息 + 状态卡片（InfoCard）

**需求：**
- 信息模块只展示两项：**标题**（title）与 **URL**，去掉 Lang/Duration/Focus 等字段。
- 状态条单独成区块，上下有分割线，所有 step 状态 pill 缩小字号与尺寸。

**设计：**
- **Header（信息区）**
  - 上行：`Title`（`task.meta.title`），单行显示，超出使用省略号，字体比正文稍大一号。
  - 下行：`URL`（`task.meta.url`），字体稍小、颜色偏灰，可允许自动换行。
  - 仍使用现有 `.info-row` / `.info-label` / `.info-value` 体系，但只保留两行，并可精简 label（甚至只展示值）。
- **状态条 StatusBar**
  - 从原来的 info 区块中抽出，变成紧跟信息区下方的单独 section：
    - 顶部 `border-top`，底部 `border-bottom`，内边距略小（比如 6–8px）。
  - 所有 `.status-pill`（包括主界面和 Manage 弹窗）统一缩小尺寸：
    - 字号从当前值减小一级（如 13 → 11）。
    - padding/圆角/间距整体缩小，使 pill 更紧凑但仍可读。
    - icon 尺寸与间距相应缩小，保持视觉平衡。
  - 行为逻辑不变：仍根据 steps 状态渲染 running/done/error。

---

### 3. Article/Summary 内容卡片（ContentCard）

**需求：**
- Article/Summary 区块采用「功能栏 + 展示栏」样式：
  - 功能栏：Article / Summary 切换按钮。
  - 展示栏：直接展示 Markdown 内容，不需要大面积灰底外框；外层容器内边距为 0。
- 展示区域内部单独滚动（A 选项），中间主面板和其他区域不跟随滚动。

**设计：**
- **Header（功能栏）**
  - 使用一个紧凑的 tab/button 组替代当前较大的 tab：
    - `Article` / `Summary` 两个按钮，放在卡片顶部左侧。
    - active 状态有明显视觉（如下划线或深色背景），非 active 状态为浅灰。
  - Header 底部加一条细边界线与展示区域分隔。
- **Body（展示栏）**
  - 外层容器高度占据中间列剩余可用空间，设置 `overflow-y: auto`，成为独立滚动区域。
  - 外层容器本身 `padding: 0`，不再添加额外灰色背景；视觉留白交由内部 `.markdown-content` 控制。
  - `.markdown-content` 继续使用现有 Markdown 样式（标题、段落、列表、表格等），确保文章阅读体验良好。
  - 切换 Article/Summary 时：
    - 仅替换 `.markdown-content` 的 HTML（由 `marked` 渲染），并将滚动位置重置到顶部。

---

### 4. 交互与行为对齐

- InfoCard 与 ContentCard 高度随窗口自适应，中间列整体仍保持原有 flex 布局。
- Article/Summary Header 的 active 状态与当前选中的内容保持一致（与 tabs 点击逻辑共用同一状态源）。
- 所有状态 pill 的缩放在主界面与弹窗中保持一致，避免「主界面缩小 / 弹窗仍偏大」的割裂感。

---

### 5. 实现注意点（供后续实现计划使用）

- 修改范围集中在 `electron/src/renderer/index.html`：
  - 精简信息区 DOM 只保留 Title/URL 行。
  - 抽离或重新包装状态条 DOM，使之成为独立区块，并应用统一缩小样式。
  - 重构 Article/Summary 区块结构为 Header + Body，Body 内部作为 scroll 容器，移除外层多余的灰色背景与 padding。
- 谨慎调整 CSS，避免影响左侧历史列表和右侧 video/subtitle 区域；变更仅作用于中间主面板相关类名。

