---
migrated: 2026-06-29
superseded_by:
  - 2026-06-16-electron-to-web-migration-design.md  # 信息面板在 Web 端新信息架构中已重新设计
implemented_in:
  - web/src/routes/tasks.$id.tsx  # 信息面板已集成为任务详情页右侧区域
---

# 设计文档：进度展示从中间界面迁移至信息面板

**日期：** 2026-05-24  
**分支：** feature/gui-redesign  
**状态：** 已确认，待实现

---

## 一、背景与目标

### 现状问题

任务运行中，进度信息在两处重复出现：

1. **主内容区**（`#progressSection`）：横向 fill bar + 8 个脉冲步骤点，位于 [文章]/[摘要] 标签栏下方
2. **右侧信息面板**（`§5.5 信息面板`）：8 步 status pill，位于「信息」tab 的「处理进度」字段组

这造成：
- 进度信息冗余，同一数据两种形态同时可见
- 主内容区标签栏与内容体之间被进度条打断，视觉层级混乱
- 两处进度展示互不一致时容易引起困惑

### 设计目标

- 进度只在**一处**展示：右侧面板「信息」tab
- 主内容区干净，标签栏直接衔接内容体
- 用户停留在「播放」tab 时，仍能感知任务运行状态

---

## 二、设计方案

### 2.1 移除主内容区进度条

删除 `#progressSection`（含 `#progressFill` 和 `.progress-step` 列表）在主内容区的渲染。

任务运行中，主内容区不再展示任何进度 UI。运行状态的视觉感知通过以下两处保留：

| 位置 | 表现 | 说明 |
|---|---|---|
| 侧栏任务列表 | 黄色状态点（`.status-dot.running`） | 全局感知，任务是否在跑 |
| 工具栏 | 「中止」按钮（`.btn.danger`）出现 | 操作层面的运行状态提示 |

### 2.2 信息面板为进度的唯一来源

右侧面板「信息」tab 的「处理进度」字段组（`§5.5`）保持不变，8 步 status pill 是进度的唯一展示位置。

pill 状态定义：

| 状态 | 样式类 | 图标 | 说明 |
|---|---|---|---|
| 未开始 | （默认） | — | 灰色边框，灰色文字 |
| 进行中 | `.active` | ◐ | 黄色背景，脉冲动画 |
| 完成 | `.done` | ✓ | 绿色背景 |
| 失败 | `.error` | ✗ | 红色背景，可点击，hover 提示「重试」 |

### 2.3 「信息」tab 标签增加状态原点

当任务运行中，在「信息」tab 的标签文字右侧显示一个小圆点，提示用户进度在此处可查看。

**状态原点的三种状态：**

| 任务状态 | 原点颜色 | 动画 | 出现条件 |
|---|---|---|---|
| 运行中（至少一步 active） | 黄色 `#FFD700` | 脉冲（1.4s 循环） | 任意步骤处于 `active` |
| 有步骤失败 | 红色 `#EF4444` | 静止 | 任意步骤处于 `error`，且无 `active` |
| 完成 / 空状态 | — | — | 无点，不展示 |

**实现位置：** `[data-panel="info"]` 按钮（`#panelTabs` 内第二个 `.panel-tab`），状态点作为内联 `<span class="tab-status-dot">` 实现（避免 `::after` 与 tab 激活边框冲突）。

**CSS 参考：**

```css
.tab-status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-left: 5px;
  vertical-align: middle;
  position: relative;
  top: -1px;
}

.tab-status-dot.running {
  background: #FFD700;
  animation: pulse 1.4s infinite;
}

.tab-status-dot.error {
  background: #EF4444;
}
```

---

## 三、UI 状态对照

### 3.1 任务运行中，用户在「播放」tab

| 区域 | 变化 |
|---|---|
| 主内容区标签栏 | 无进度条（直接到内容体） |
| 工具栏 | 「中止」按钮可见 |
| 侧栏状态点 | 黄色 |
| 「信息」tab 标签 | 黄色脉冲状态点 |
| 「信息」tab 内容 | 进度 pill 实时更新（SSE 驱动） |

### 3.2 任务运行中，用户切换到「信息」tab

| 区域 | 变化 |
|---|---|
| 「处理进度」字段组 | 8 步 pill，active 步骤脉冲显示 |
| 「信息」tab 标签 | 黄色脉冲点仍可见（tab 已激活，点仍保留直到任务完成） |

### 3.3 有步骤失败（非运行中）

| 区域 | 变化 |
|---|---|
| 「信息」tab 标签 | 红色静止点 |
| 「处理进度」对应 pill | `.error` 样式，可点击打开重试弹窗 |

### 3.4 任务完成

| 区域 | 变化 |
|---|---|
| 「信息」tab 标签 | 状态点消失 |
| 「处理进度」所有 pill | `.done` 样式 |

---

## 四、实现范围

### 需要修改

| 文件 | 操作 |
|---|---|
| `electron/src/renderer/index.html` | 删除 `#progressSection` DOM；在「信息」tab 按钮内添加 `.tab-status-dot` span；添加对应 CSS |
| `electron/src/renderer/index.html`（JS 部分） | JS 中目前无 `#progressSection` 操作代码（DOM 存在但未接入逻辑）；新增更新 `.tab-status-dot` 状态的逻辑（running/error/hidden），由 SSE 步骤事件驱动 |

### 不需要修改

- 信息面板 status pill 的 HTML 结构（已存在于 `§5.5`）
- SSE 事件处理逻辑（数据驱动不变，只是消费者变了）
- DESIGN.md `§5.3` 中关于 `#progressSection` 的条目（待同步更新文档）

### 需要同步更新

- `DESIGN.md §5.3 任务运行中`：删除 `#progressSection` / `#progressFill` / `.progress-step` 条目，新增「信息 tab 状态点」行为描述
- `docs/reference/design-previews/app-renderer-design.html`：更新状态 3（running）的 mockup，移除进度条，加状态点

---

## 五、不在本次范围

- 信息面板扩展字段（发布日期、播放量等，见 `docs/reference/info-pane-roadmap.md`）
- 「信息」tab 主动自动切换（任务开始时不强制跳转，用户保持在当前 tab）
- 主内容区的任何其他 UI 调整

---

## 六、设计预览

对比 mockup 保存于：
- `.superpowers/brainstorm/71414-1779603811/content/progress-redesign-compare.html`（Before/After 对比）
- `.superpowers/brainstorm/71414-1779603811/content/progress-redesign-v2.html`（状态点三态说明）
