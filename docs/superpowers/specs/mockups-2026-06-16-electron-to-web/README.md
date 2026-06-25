# 前端概念图 · 2026-06-16

配套设计文档：[`../2026-06-16-electron-to-web-migration-design.md`](../2026-06-16-electron-to-web-migration-design.md)

## 文件清单

| 文件 | 场景 | 对应 spec 章节 |
|---|---|---|
| `01-home.html` | 首页：任务列表 + 侧栏 + SSE 实时状态 | §4 |
| `02-detail.html` | 详情页：播放器 + 转录 + 总结阅读 + TOC | §3 |
| `03-cmdk.html` | ⌘K 命令面板浮层 | §4 |

## 如何查看

```bash
open docs/superpowers/specs/mockups-2026-06-16-electron-to-web/01-home.html
open docs/superpowers/specs/mockups-2026-06-16-electron-to-web/02-detail.html
open docs/superpowers/specs/mockups-2026-06-16-electron-to-web/03-cmdk.html
```

或一次性全开：

```bash
open docs/superpowers/specs/mockups-2026-06-16-electron-to-web/*.html
```

## 关键设计点（请审批时重点关注）

### 整体
- **强调色 Sage**（#5A8A5A 系列 · Forest Calm）：按钮、链接、进度、激活态、引用块边线
- **浅色优先**（跟随系统）：默认 `#F7F8F5` 清晨雾底，深色模式自动切到 `#1A1D1A` 深森林
- **中文 line-height 1.75 / 阅读区 1.85**：保证中文段落呼吸感
- **mono 字体**（JetBrains Mono）：URL、时间戳、命令、计数

### 01-home
- **侧栏分组**：状态（全部/进行中/已完成/失败）+ 模式过滤
- **进行中任务**：`pulse-iris` 脉动动画 + 5 段进度条（fetch/download/convert/transcribe/generate）
- **CLI 提示框**：左下角固定显示 `vdl <URL>` 模板 + 复制按钮（不提供 Web 创建入口）
- **任务卡片**：缩略图 88×56 + 标题 + URL + 模式徽章 + 状态点
- **底部状态条**：后端连接 + SSE 状态 + 进行中任务计数
- **失败任务**：行内显示错误原因 + 重跑按钮

### 02-detail
- **左右分栏 42% / 58%**：左播放器+转录，右总结阅读
- **播放器自定义控件**：与设计语言一致的播放/进度/全屏
- **章节胶囊**：横向滚动的章节快速跳转
- **转录联动**：当前段 `bg-iris-3` + 左边线 + 时间戳标"正在播放"
- **双语切换**：转录顶部 Tab（中文 / English）
- **Tabs**：总结 / 文章 / 元信息 / 步骤日志
- **顶栏操作**：复制全文 / 导出 MD / 打包 ZIP / 本机打开文件夹
- **TOC**：右侧固定 + scroll-spy 激活
- **引用块**：Iris 左边线 + Iris-3 浅底 + 圆角
- **沉浸模式入口**：顶栏 `F · 沉浸` 按钮

### 03-cmdk
- **半透明遮罩 + 顶部 14vh 弹出**
- **结果分组**：任务 / 命令
- **任务命中高亮**：匹配文字 Iris 着色
- **命令清单**：复制 vdl 模板 / 切换主题 / 打开 work 目录 / 设置
- **底栏快捷键提示**：↑↓ / ↵ / ESC
- **首项默认选中**（item.selected），右侧 ↵ 提示

## 已知简化

这些是概念图，**不代表最终代码实现**：

1. Tailwind 走 CDN（生产用 Tailwind v4 + 本地构建）
2. 颜色直接写 CSS 变量（生产用 Radix Colors 完整 12 阶 + next-themes）
3. 无真实交互（点击/键盘）；仅展示状态
4. 字体走 rsms.me/inter CDN（生产用 @fontsource/inter）
5. 真实视频缩略图缺失（用占位渐变）
6. 浅色模式仅声明 CSS 变量，未在概念图切换（生产支持系统跟随）

## 反馈方式

请直接在审批时说明：
- 哪些元素要保留 / 删除 / 改位置
- 颜色 / 字号 / 间距是否需要调整
- 是否需要补充其他场景的概念图（如设置页 / 空状态 / 失败详情 / 浅色变体）

确认后我会调用 `writing-plans` 进入实施计划阶段。
