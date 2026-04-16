# 前端设计系统

基于当前 Electron 主界面实现与 ui-ux-pro-max 设计系统检索结果整理，供产品与开发统一语言。

---

## 一、当前项目风格（代码内约定）

### 1. 风格名称与基调

- **名称**：Swiss Minimal（瑞士极简）
- **基调**：黑白灰、无装饰、直角、网格对齐、信息优先

### 2. 设计令牌（:root）

| 令牌 | 值 | 用途 |
|------|-----|------|
| `--grid-unit` | 8px | 间距与留白基准 |
| `--bg` | #FFFFFF | 主背景（卡片、弹窗） |
| `--bg-alt` | #FAFAFA | 页面底衬 |
| `--text` | #111111 | 主文字 |
| `--text-secondary` | #666666 | 次要文字 |
| `--text-muted` | #999999 | 辅助/说明文字 |
| `--border` | #E5E5E5 | 分割线、描边 |
| `--accent` | #000000 | 强调、主按钮、焦点 |
| `--radius` | 0px | 圆角（直角） |
| `--transition` | 0.15s ease | 交互动效时长 |

### 3. 字体与排版

- **字体**：Inter（400 / 500 / 600），系统回退 -apple-system, BlinkMacSystemFont, 'Segoe UI'
- **正文**：14px，line-height 1.5
- **标题/强调**：font-weight 600，14px
- **小标签**：11px，uppercase，letter-spacing 0.05em，用于 History 等区块

### 4. 组件约定

- **按钮**：直角、1px 描边、hover 时 border 变为 accent；主按钮 `.btn.primary` 黑底白字；危险操作 `.btn.danger` 红底白字（#D00 / #B00 hover）
- **单选**：`.radio-label` + `.radio-custom` 自定义样式，隐藏原生 input，hover 有背景与描边反馈
- **弹窗**：`.modal-overlay` 全屏半透明蒙版 + `.modal` 白底描边，标题与内容区分明确

### 5. 布局

- **栅格**：padding / margin 以 `calc(var(--grid-unit) * N)` 为主（如 2、3）
- **侧栏**：240px 固定宽；主区 flex:1；视频面板 400px 固定宽

---

## 二、ui-ux-pro-max 与本项目的对齐点

- **字体**：推荐 Inter，与当前一致；适合 dashboard / 生产力工具。
- **交互**：微动效、hover 反馈、150–300ms 过渡；与现有 `--transition: 0.15s ease` 一致。
- **可访问性**：可点击元素 `cursor: pointer`、键盘焦点可见、对比度 ≥4.5:1；当前主文字 #111 on #FFF 已达标。
- **确认弹窗**：破坏性操作前必须确认（与现有删除确认弹窗一致）。

---

## 三、全局浮层/弹窗的实现原则

1. **沿用设计令牌**：背景、文字、边框、间距均使用 `--bg` / `--text` / `--text-muted` / `--border` / `--grid-unit`，不写死色值（危险按钮除外）。
2. **8px 栅格**：弹窗内 padding、选项间距、按钮区留白为 grid-unit 的整数倍。
3. **与主界面一致**：标题、说明、单选样式与 New Task 等弹窗统一（如使用 `.modal-title`、`.radio-label` + `.radio-custom`）。
4. **交互反馈**：按钮保持 `cursor: pointer` 与 `transition`，危险按钮保持高对比度红色。
5. **层叠稳定性**：新增全局浮层时，显示时执行 `document.body.appendChild(modal)` 确保节点在 body 末尾，配合独立全屏蒙版与高 `z-index`（见 [adr/2026-03-15-electron-modal-stacking.md](../adr/2026-03-15-electron-modal-stacking.md)）。
