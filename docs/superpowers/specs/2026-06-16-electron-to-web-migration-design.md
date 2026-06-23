---
date: 2026-06-16
topic: electron-to-web-migration
status: draft
owner: harveyzhang96
todo_id: 5
---

# 将前端架构从 Electron 迁移至 Web — 设计文档

## 概述

将现有 Electron 前端**彻底重构**为 Web 端架构。Web 端专注浏览/阅读/播放体验，面向用户使用；Agent 操作逻辑继续保留在 CLI 层，不迁入 Web 端。**分离关注点：浏览 = Web，操作 = CLI。**

本次为完整技术栈替换，目标是建立可持续演进的现代前端基线，重点打磨「产物阅读 / 播放体验」与「任务列表 / 历史检索」两大场景。

## 背景

现有 Electron renderer 是单文件 `index.html`（3284 行），所有 UI、状态、业务逻辑混在一起：
- 维护成本高：任何改动都要在巨型文件里搜索锚点
- 设计语言陈旧：手写 CSS、缺乏一致性、不支持系统主题
- 交互平淡：无微动效、无命令面板、无虚拟滚动、无 SSE 驱动的实时反馈
- 锁定 Electron：用户必须打开桌面壳，不能用浏览器访问

后端 HTTP API（Koa + SSE + SQLite）已经成熟稳定，是状态权威。**前端只是一层 UI**，可以独立替换而不影响后端契约。

## 用户故事

- **U1**：任务完成后我打开详情页，左侧播放视频，右侧阅读总结，点击转录段落视频自动跳转，选中文字可一键复制为引用。
- **U2**：我历史任务很多时按 ⌘K 模糊搜索标题/URL，快速定位；切换"已完成 / 失败 / 进行中"侧栏分组浏览。
- **U3**：我在 Chrome 中访问 `http://127.0.0.1:3000` 即可使用，无需打开 Electron 壳。
- **U4**：进行中任务通过 SSE 实时推送进度，无需刷新即可看到状态变化。

> **任务创建不在 Web 端范围内。** 用户通过 CLI（`vdl <URL>`）或 Agent 调用 CLI 创建任务；Web 端只负责浏览、阅读、播放、检索、管理（删除/重跑/取消）。

## 范围

**本次只产出设计 spec，不写实施计划、不动代码。** 实施由后续 `writing-plans` 技能展开。

---

## §0 技术栈

### 核心
```
Vite 6 + React 19 + TypeScript (strict)
TailwindCSS v4（CSS-first 配置）
shadcn/ui（Radix UI primitives 复制粘贴所有权）
```

### 状态 / 数据
```
TanStack Query v5     HTTP 请求与缓存
Zustand               轻量 UI 状态
EventSource (原生)    SSE 订阅，由自定义 hook 托管
```

### 交互 / 动效
```
Framer Motion         页面过渡、列表 enter/exit、抽屉
Lucide React          图标库
cmdk                  ⌘K 命令面板
sonner                Toast 通知
```

### 内容渲染
```
react-markdown + remark-gfm + rehype-shiki   Markdown 渲染 + 代码高亮
@tanstack/react-virtual                       虚拟滚动
media-chrome                                  自定义皮肤的视频播放器
wavesurfer.js                                 音频波形可视化
```

### 路由 / 主题
```
react-router v7 (data router 模式)
next-themes                跟随系统的明暗切换
@fontsource/inter          Inter 正文
@fontsource/jetbrains-mono JetBrains Mono 等宽
```

### 测试 / DX
```
Vitest + @testing-library/react   单元 + 组件测试
Playwright                        E2E（含 SSE 流 + 视觉回归）
ESLint flat config + Prettier
```

### 部署
```
开发：vite dev (5173)，proxy /api & /events → 127.0.0.1:3000
生产：vite build → web/dist；Koa + koa-static 单端口托管
```

---

## §1 目录结构

```
web/                          ← 新前端，独立目录
  src/
    routes/                   react-router 路由
      _index.tsx              任务列表（首页）
      tasks.$id.tsx           任务详情（产物阅读）
      settings.tsx
    components/
      ui/                     shadcn/ui 复制的基础组件
      task-card/
      task-progress/
      reader/                 Markdown 阅读器
      player/                 视频/音频播放器 + 波形
      command-palette/        ⌘K
      sidebar/
    hooks/
      use-task.ts             TanStack Query wrappers
      use-task-stream.ts      SSE hook
      use-theme.ts
      use-hotkeys.ts
    lib/
      api.ts                  fetch 客户端（Bearer token 注入）
      sse.ts                  EventSource 抽象
      markdown.ts             react-markdown 配置
      time.ts                 时长 / 时间戳格式化
    stores/                   Zustand stores
      ui-store.ts             侧栏、主题、⌘K、多选
      player-store.ts         播放状态、转录联动
    styles/
      globals.css             Tailwind v4 + 主题 CSS 变量
  index.html
  vite.config.ts
  tsconfig.json
  package.json

electron/                     不动，过渡期保留作 fallback
services/http-server/         新增 koa-static 托管 web/dist 与 /legacy
```

---

## §2 设计语言（Forest Calm · 阅读友好 · 跟随系统主题）

### 色彩系统

强调色：**Sage**（鼠尾草绿，#5A8A5A 系列）。整体走"森林静谧"路线，低饱和、高可读性，长时间阅读不疲劳。

**底色保持中性暖灰，绿色只用于强调（按钮、链接、激活态、进度、引用边线）。**

**浅色模式（默认 · 主用 · 温润书房版）**：
```
--bg-canvas      #F9F8F4   暖纸底（去绿调，保留温润）
--bg-surface     #FFFFFF   卡片纯白
--bg-elevated    #F1EFE9   弹窗/悬浮层（厚一点）
--border-subtle  #E5E2DA   米色分隔线（可见但柔）
--border-strong  #CFCBC0
--text-primary   #2C2A24   暖深黑（舒适、有重量）
--text-secondary #67645E   暖中灰
--text-tertiary  #9C9890
--accent-9       #5A8A5A   Sage 强调（仅按钮/链接/进度等元素用）
--accent-10      #466F46   hover/active
--accent-3       #EBF1E8   强调浅底（引用/激活背景，仅限点状区域）
--accent-12      #243B24   强调深字
--status-ok      #4A8A5A   森绿
--status-err     #B05050   胭脂红
--status-busy    #C28A3D   葡萄色
```

**深色模式（系统暗色时切换）**：
```
--bg-canvas      #1A1A18   暖中性深底（无绿色调）
--bg-surface     #232322   卡片
--bg-elevated    #2A2A28
--border-subtle  #2E2E2B
--text-primary   #E8E8E6
--text-secondary #9A9B98
--text-tertiary  #6B6C69
--accent-9       #7DAE7D   深色模式提亮的 Sage
--accent-3       #2A3A2A   强调浅底
```

由 `next-themes` 根据系统切换；用户也可在 ⌘K 命令面板手动覆盖。

### 排版

```
正文：Inter 14px / line-height 1.6
中文专门覆盖：line-height 1.75（中文需更大行距）
标题：Inter 18-32px / tracking-tight
等宽：JetBrains Mono 13px（转录、URL、代码）
```

### 间距 / 圆角 / 阴影

```
间距：Tailwind 默认刻度 (4/8/12/16/24/32/48)
圆角：6px (卡片) / 8px (弹窗) / 4px (按钮、徽章)
阴影：仅 overlay 用；列表/卡片仅靠 1px border + 微亮度差区分层级
```

### 微交互

- 所有 hover / focus：120ms ease-out
- 列表 enter：staggered 30ms delay + 8px slide-up
- 模态 / 抽屉：250ms ease-out-quart
- 不用 bouncy spring（介于 Notion 的软与 Linear 的硬之间）

---

## §3 重点交互场景 A：产物阅读 / 播放体验

### 任务详情页布局（极简阅读版）

```
┌──────────────────────────────────────────────────────┐
│ ← [视频标题]              沉浸F  ⌘K  ⋯              顶栏
├──────────────────────┬───────────────────────────────┤
│  ▶ 3:42 / 15:32 ──   │  [总结] [文章]      复制    Tabs
│  视频播放器            │ ─────────────────────────────
│                      │
│ 中文 · EN    6 段    │  阅读区 14px / line 1.85
│ ──────────────────   │
│  0:00  大家好…       │   ## 一、预训练
│  0:42  这个领域…     │   预训练是 LLM 训练的…
│ ●3:42  第一阶段…     │   > 引用块（极细 Sage 左边线）
│  4:18  这个过程…     │   - 数据规模
│  5:01  预训练完成…    │   - 输出形态                42%
│                      │           目录（细栏）
│                      │           · 概览
│                      │           · 一、预训练 ●
│                      │           · 二、SFT
└──────────────────────┴───────────────────────────────┘
```

**砍掉**：章节胶囊条、字幕搜索、字幕开关、状态徽章、状态点、4 个操作按钮（仅留"复制"，其余进 `⋯`）、右侧元信息块。

**保留**：双栏 42 : 58、转录联动当前段、阅读区 14px / 1.85、TOC scroll-spy、中英字幕切换（纯文本链接）。

### 关键交互

- **播放器 ⇄ 转录联动**：
  - 点击转录段落 → 视频跳转到对应 timestamp
  - 视频播放时高亮当前段（karaoke 风），自动滚动转录列表
  - 状态托管于 `player-store.ts`（Zustand）
- **章节导航**：基于总结里的 `##` / `###` 标题自动生成 TOC，scroll-spy 高亮
- **沉浸模式**：按 `F` 隐藏侧栏 + 顶栏，全屏阅读
- **复制行为（Notion 风）**：选中文字 → 浮出小气泡 `[复制]` `[复制为引用]`
- **导出**：
  - 单文件 Markdown 下载（前端拼装）
  - 打包 ZIP（含媒体）走后端新端点（spec 中标记为 §5 待补充端点）
- **打开本地文件夹**：调用 `POST /api/tasks/:id/reveal`（loopback 模式下后端 spawn `open`）

### 媒体播放器

- **视频**：`media-chrome` Web Component，自定义皮肤匹配 Sage 主题
- **音频**：`media-chrome` 外壳 + `wavesurfer.js` 渲染波形条，章节标记叠加在波形上
- **键盘**：`Space` 播放/暂停、`←/→` 5s 跳转、`J/K/L` YouTube 风、`,/. ` 逐帧（视频）

### 中文阅读优化

- 中文段落 `line-height: 1.75`，西文混排 `font-feature-settings: "ss01"` 让数字对齐
- 中英文之间自动空格（前端 CSS `word-spacing` + 内容预处理）
- 引用块用 Sage-3 背景 + Sage-9 左边线

---

## §4 重点交互场景 B：任务列表 / 历史检索

### 首页布局（极简阅读版）

```
┌──────────────────────────────────────────────────────┐
│                                                       │
│   Video Learner                       搜索 ⌘K         │
│                                                       │
│   全部 128   进行中 3   已完成 119   失败 6           │
│   ─────────────────────────────────────────           │
│                                                       │
│   Andrej Karpathy: Deep Dive into LLMs    2 分钟前    │
│   media · 15:32 · 正在转录 47%                        │
│   ────────                                            │
│   ─────────────────────────────────────────           │
│                                                       │
│   Lex Fridman Podcast #410…             17 分钟前     │
│   audio · 1:48:21 · 下载中 41%                        │
│   ──────                                              │
│   ─────────────────────────────────────────           │
│                                                       │
│   YC Startup School · How to Find PMF   今天 14:23    │
│   transcript · 42:08 · 创业方法论                     │
│   ─────────────────────────────────────────           │
│                                                       │
│              新建任务：终端输入 vdl <URL>             │
└──────────────────────────────────────────────────────┘
```

**砍掉**：左侧栏、Logo 方块、缩略图、状态点、模式徽章、5 段进度（改细 2px 单条）、CLI 输入框、底栏状态文本。

**保留**：`max-w-3xl` 居中阅读宽度、inline 状态过滤、单行标题 + 单行 meta + 进度条（仅运行时）、悬停浅底高亮、失败任务行内红字。

### 关键交互

- **⌘K 命令面板**（cmdk）：
  - 模糊搜索任务标题 / URL / focus
  - 命令模式：`> 新建任务` `> 切换主题` `> 打开文件夹` `> 导出当前任务`
  - 最近访问、置顶任务
- **任务卡片**：
  - 缩略图（yt-dlp 抓取的封面）
  - 标题（粗 14px）+ uploader / 时长 / 创建时间（12px secondary）
  - 进度条：5 步骤分段（fetch / download / convert / transcribe / generate），完成段填 Sage-9，进行中段脉动动画
  - 模式徽章：`media` / `audio` / `transcript` / `full`
  - 状态点：进行中 Sage-9 脉动 / 完成 green-9 / 失败 red-9
- **实时更新**：
  - SSE 推送 `task.update` → 卡片进度条无刷新更新
  - `task.created` → 新卡片从顶部 slide-in（Framer Motion `<AnimatePresence>`）
- **批量操作**：
  - Shift + 点击多选 → 底部浮动操作栏 `[重跑] [删除] [导出]`
  - 多选用 Zustand `ui-store.selectedTaskIds: Set<string>`
- **筛选 / 排序**：
  - 模式（media/audio/transcript/full）
  - 状态（pending/running/done/failed/canceled）
  - 日期范围
- **虚拟滚动**：>50 条历史时启用 `@tanstack/react-virtual`，固定行高 88px
- **空状态**：友好插画 + 「使用 `vdl <URL>` 在 CLI 创建任务」引导文案 + 命令复制按钮

### 任务创建（明确不在 Web 端）

- Web 端**不提供**新建任务 UI、URL 输入框、模式选择 Modal
- 用户在 CLI 输入 `vdl <URL>`，或由 Agent 调用 CLI
- 新任务通过 SSE `task.created` 事件推送到前端，卡片从顶部 slide-in
- ⌘K 命令面板中可包含「复制 vdl 命令模板」快捷项，但不直接发起创建

---

## §5 后端契约（前端依赖的 HTTP API）

### 现有端点（不动）
```
GET    /api/tasks?limit=N
POST   /api/tasks                       { url, mode, focus, output_lang, timeout_scale }   ← 仅 CLI 调用，Web 不用
GET    /api/tasks/:id
GET    /api/tasks/:id/media
GET    /api/tasks/:id/subtitles
GET    /api/tasks/:id/result/content?type=...
GET    /api/tasks/:id/steps
POST   /api/tasks/:id/steps/:step/run
DELETE /api/tasks/:id?reset_scope=...
POST   /api/tasks/:id/cancel
POST   /api/tasks/:id/resume
POST   /api/tasks/:id/steps/:step/cancel
GET    /api/events                      SSE
```

### 新增端点（本次迁移需要）
```
GET    /                                返回 web/dist/index.html，注入 token meta
GET    /assets/*                        web/dist 静态资源
GET    /legacy                          旧 Electron renderer fallback
GET    /api/session                     { token } — 备选 token 获取方式
POST   /api/tasks/:id/reveal            spawn OS opener；仅 loopback 启用
GET    /api/tasks/:id/export.zip        产物打包下载（含媒体）
```

### Token 传递
- 同源场景：HTML 中注入 `<meta name="vdl-token" content="...">`
- SSE 连接：`?token=...` query 参数（`EventSource` 不支持自定义 header）
- 普通 fetch：`Authorization: Bearer <token>` header
- 仅 loopback 绑定时启用 reveal 端点

---

## §6 状态管理边界

### TanStack Query 管理（HTTP 状态）
| Query Key | 端点 | 失效触发 |
|---|---|---|
| `['tasks']` | `GET /api/tasks` | SSE `task.created` / `task.deleted` |
| `['task', id]` | `GET /api/tasks/:id` | SSE `task.update` (id 匹配) |
| `['task', id, 'steps']` | `GET /api/tasks/:id/steps` | SSE `step.update` |
| `['task', id, 'artifact', type]` | `GET /api/tasks/:id/result/content` | 任务完成后失效 |

Mutations：`createTask` / `cancelTask` / `resumeTask` / `deleteTask` / `runStep` / `cancelStep`，全部使用 `optimisticUpdate`。

### Zustand 管理（UI 状态）
```ts
ui-store.ts:
  sidebarCollapsed: boolean
  theme: 'system' | 'light' | 'dark'
  commandPaletteOpen: boolean
  selectedTaskIds: Set<string>
  filter: { mode?: Mode[], status?: Status[], dateRange?: [Date, Date] }
  sort: { by: 'createdAt' | 'updatedAt' | 'title', dir: 'asc' | 'desc' }

player-store.ts:
  currentTaskId: string | null
  playing: boolean
  currentTime: number
  duration: number
  activeSubtitleIndex: number | null
  immersive: boolean
```

### SSE Hook
```ts
useTaskStream():
  内部建立 EventSource('/api/events?token=...')
  解析 event.type：
    'task.created'  → queryClient.invalidateQueries(['tasks'])
    'task.update'   → queryClient.invalidateQueries(['task', id])
    'step.update'   → queryClient.invalidateQueries(['task', id, 'steps'])
    'task.deleted'  → queryClient.removeQueries(['task', id]) + invalidate ['tasks']
  断线重连：浏览器原生 EventSource 自动重连；tab 重新可见时强制全量 invalidate
```

---

## §7 鉴权模型

- **安全边界**：Koa 服务绑定 `127.0.0.1`（loopback），这是唯一安全边界
- **Token 来源**：后端启动时生成（已有逻辑），通过 `<meta>` 标签下发首屏
- **请求方式**：fetch 用 `Authorization: Bearer`；SSE 用 `?token=`
- **不做**：cookie/CSRF/登录 UI/CORS（LAN/远程访问明确不在范围）

风险标注：`<meta>` 标签可被第三方脚本读取。本地单用户 + loopback 场景下风险极低，但 spec 留出未来改造空间——若引入浏览器扩展或嵌入第三方 widget，必须改为 `HttpOnly` cookie。

---

## §8 与旧 Electron 并存策略

### 开发期
```
旧：bash start-electron.sh         继续可用，开发期不删
新：cd web && npm run dev          浏览器访问 http://localhost:5173
```

### 发布期
```
Koa 服务同时提供：
  /         → web/dist/index.html     (新 Web)
  /legacy   → electron/src/renderer   (旧 Electron renderer，静态托管)

用户可在新 Web 顶栏点「切回旧版」跳到 /legacy
旧 Electron 壳本身保留，BrowserWindow 默认 loadURL 新 Web
```

### 退役时机
- 新版稳定运行 2-4 周后
- 删除 `electron/` 目录 + `/legacy` 路由
- 将 `web/` 升级为前端主目录（可选）
- 单独 PR

---

## §9 测试策略

### 单元 / 组件
- **Vitest + Testing Library**：
  - hooks：`useTaskStream`、`useTask`、`useHotkeys`
  - 纯组件：`TaskCard`、`TaskProgress`、`MarkdownReader`
  - 工具：`time.ts`、`api.ts`

### E2E（Playwright）
- 黄金路径：粘贴 URL → 进度推进 → 阅读总结
- SSE：模拟断线重连后状态一致
- 多任务并发：3 个任务同时进度推进
- 命令面板：⌘K 搜索 → 跳转
- 主题切换：明暗双主题视觉回归（screenshot 对比）

### 后端测试
- 后端 Node 无框架测试**不动**
- 新增 `tests/http-static-serve.test.js`：`GET /` 返回带 token meta 的 HTML
- 新增 `tests/http-reveal.test.js`：`POST /api/tasks/:id/reveal` 触发 spawn；非 loopback 拒绝
- 新增 `tests/http-export-zip.test.js`：导出端点行为

---

## §10 风险与缓解

| 风险 | 缓解 |
|---|---|
| 重构期产品停摆 | 新旧并存（§8），旧 Electron 始终可用 |
| 旧 renderer 79 个 UI 元素遗漏 | 附录 A 列出功能清单，spec 评审时逐项对照 |
| TypeScript strict 学习成本 | 渐进开启；首版允许局部 `any`，迭代收紧 |
| shadcn 默认西文排版，中文 line-height 偏紧 | `globals.css` 全局覆盖中文段落 `line-height: 1.75` |
| SSE 在 tab 后台时被节流 | tab `visibilitychange === 'visible'` 时强制 `invalidateQueries(['tasks'])` |
| Bundle 体积（React 19 全套 ~250KB gz） | 路由级 code-split；`media-chrome` / `wavesurfer` / `rehype-shiki` 懒加载 |
| `<meta>` token 被第三方脚本读取 | 文档警示；CSP `script-src 'self'`；HTML 加 `Cache-Control: no-store` |
| 拖拽 / 剪贴板 / 文件下载在浏览器与 Electron 差异 | E2E 覆盖；Electron 路径在过渡期保持 |
| 3284 行旧逻辑重构遗漏 | 写实施计划阶段做"功能对照表" |

---

## §11 明确不做（Out of Scope）

- 在 Web 端暴露 CLI agent 操作（遵守「操作 = CLI」边界）
- **Web 端创建新任务**（URL 输入、模式选择 — 全部走 CLI）
- LAN / 远程 / 多用户访问
- 鉴权 UI（登录表单）
- 国际化 i18n（首版仅中文 + 英文界面切换可后续加）
- 后端契约变更（除 §5 新增端点外）
- SSR / Server Components（纯 SPA）
- PWA / 离线缓存

---

## 附录 A：旧 renderer 功能清单（需在新 Web 中覆盖）

从 `electron/src/renderer/index.html`（3284 行）提取的 UI 元素与行为：

### A.1 主框架
- 侧栏：搜索输入、历史列表、+ New 按钮
- 顶部工具栏：打开、删除、中止、继续、管理
- 中间双 Tab：article / summary
- 右侧三 Tab：player / info / subtitle
- 可拖拽分隔条 (`resizer` / `videoResizer`)

### A.2 任务创建 / 编辑 Modal (`newTaskModal`) — **新版不实现**
- 旧版 URL 输入、focus 输入、模式 radio、运行/停止/保存按钮、任务日志流全部移除
- 用户走 CLI；Web 端只显示已存在任务
- 任务日志流改为详情页内嵌入「步骤日志」面板（只读）

### A.3 详情区
- 文章 / 总结切换 (`articlePane` / `summaryPane`)
- 空状态提示
- Markdown 渲染区
- 信息面板：标题、uploader、URL、时长、语言、focus、created_at、updated_at、状态

### A.4 播放器
- video 元素 + 自定义控件（播放/暂停、停止、进度、时间显示）
- 字幕模块：语言切换、字幕轨道选择、屏幕字幕开关、字幕列表

### A.5 重试 / 重置 / 删除
- 重试确认 Modal (`retryConfirmModal`)：phase 确认 + 自动下一步开关
- 重置 popup (`resetPopup`)：步骤级重置确认
- 删除确认 Modal (`confirmDeleteModal`)：硬删除 / 软删除选择

### A.6 API 调用清单（service-client.js）
- `listTasks(limit)` → GET /api/tasks
- ~~`createTask(payload)` → POST /api/tasks~~ ← **不再由 Web 调用**（CLI 专属）
- `getTask(id)` → GET /api/tasks/:id
- `getMedia(id)` → GET /api/tasks/:id/media
- `getSubtitles(id)` → GET /api/tasks/:id/subtitles
- `getResultContent(id, type)` → GET /api/tasks/:id/result/content?type=
- `getSteps(id)` → GET /api/tasks/:id/steps
- `runStep(id, step)` → POST /api/tasks/:id/steps/:step/run
- `deleteTask(id, scope)` → DELETE /api/tasks/:id
- `cancelTask(id)` → POST /api/tasks/:id/cancel
- `resumeTask(id)` → POST /api/tasks/:id/resume
- `cancelStep(id, step)` → POST /api/tasks/:id/steps/:step/cancel
- `events()` → EventSource /api/events

### A.7 Electron IPC（迁移后由 HTTP 端点替代）
- `window.service.getServiceInfo()` → `<meta name="vdl-token">` + 同源 baseUrl
- `window.electron.openTaskFolder(id)` → `POST /api/tasks/:id/reveal`

---

## §12 落地顺序建议（非实施计划，仅给后续 writing-plans 参考）

1. **基线**：搭 `web/` 脚手架、Vite + React + TS + Tailwind + shadcn 初始化
2. **后端契约**：Koa 增加 `koa-static`、`/api/session`、`/api/tasks/:id/reveal`、`/legacy`
3. **核心 API 层**：`lib/api.ts`、`lib/sse.ts`、`hooks/use-task.ts`、`hooks/use-task-stream.ts`
4. **首页（场景 B）**：侧栏 + 任务卡片 + 虚拟列表 + ⌘K + SSE 实时
5. **详情页（场景 A）**：双栏布局 + Markdown 阅读 + media-chrome 播放器 + 转录联动
6. **波形 + 沉浸模式 + 导出 ZIP**
7. **过渡期 fallback**：Electron BrowserWindow loadURL 切换；`/legacy` 路由可用
8. **测试 + 视觉回归**：Vitest + Playwright 全覆盖
9. **退役清理**：删除 `electron/` 和 `/legacy`（独立 PR，2-4 周后）

---

## 评审清单

请在批准前确认：
- [ ] §0 技术栈选型可接受（React + Vite + shadcn + Sage）
- [ ] §2 设计语言方向认可（Notion/Linear 混合 + 跟随系统）
- [ ] §3 详情页布局与播放器/转录联动符合期望
- [ ] §4 首页 ⌘K + 虚拟列表 + SSE 实时方案符合期望
- [ ] §5 新增 4 个端点（`/`、`/legacy`、`/api/session`、`/api/tasks/:id/reveal`、`/api/tasks/:id/export.zip`）可接受
- [ ] §8 新旧并存 2-4 周稳定期合理
- [ ] §11 Out-of-scope 边界没有遗漏
- [ ] 附录 A 旧功能清单完整（如有遗漏请补充）
