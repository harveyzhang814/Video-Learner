# Web 前端架构决策

> 解释 Web 前端（`web/`）的技术选型、设计语言和关键架构决策背后的原因。
> 使用方式见 [how-to/run-web.md](../how-to/run-web.md)，API 契约见 [reference/api.md](../reference/api.md)。

---

## 为何从 Electron 迁移到 Web

旧 Electron renderer 是单文件 `electron/src/renderer/index.html`（3284 行），
所有 UI、状态、业务逻辑混在一起：

- 任何改动都要在巨型文件里搜索锚点，维护成本极高
- 手写 CSS、无一致设计语言、不跟随系统主题
- 锁定桌面 Electron，用户无法用浏览器直接访问

后端 HTTP API（Koa + SSE + SQLite）已稳定成熟，是状态权威。**前端只是 UI 层**，
可以独立替换。

**边界原则**：浏览 = Web，操作 = CLI。Web 端不提供创建任务的 UI——用户通过
`vdl <URL>` 创建，Web 端只负责浏览、阅读、播放、检索和管理。这避免了
"命令行语义在 Web 上的 UI 化"带来的维护双轨问题。

---

## 技术栈选型理由

| 选项 | 理由 |
|------|------|
| **Vite + React 19 + TypeScript** | 快速 HMR、tree-shaking、组件组合模型与 SSE hook 天然契合；TypeScript strict 在重构期捕获契约漂移 |
| **TailwindCSS v4** | CSS-first 配置，直接在标记上调试样式，减少 CSS 文件碎片化 |
| **shadcn/ui** | Radix UI primitives 的"复制粘贴所有权"模型，组件代码落入 repo，无版本锁定 |
| **TanStack Query v5** | 服务端状态（HTTP 响应、缓存、失效）与客户端 UI 状态严格分离；SSE 推送只需 `invalidateQueries` 即可驱动 UI 更新 |
| **Zustand** | 轻量 UI 状态（侧栏折叠、主题、播放器进度、多选集合），无 Redux 样板 |
| **原生 EventSource** | 单向推送、浏览器原生自动重连、无额外依赖；后端已实现 `/api/events` SSE 流 |
| **react-router v7** | data router 模式，loader 预取减少瀑布请求 |

**不选 WebSocket**：SSE 满足单向推送需求，且 `EventSource` 断线自动重连与后端
`sseRegistry` 的被动心跳机制完美配合（见 [singleton-backend.md](singleton-backend.md)）。

---

## 状态管理边界

```
TanStack Query 管理（服务端状态）
  ['tasks']          → GET /api/tasks          失效触发：SSE task.created / deleted
  ['task', id]       → GET /api/tasks/:id       失效触发：SSE task.update
  ['task', id, steps]→ GET /api/tasks/:id/steps 失效触发：SSE step.update

Zustand 管理（客户端 UI 状态）
  ui-store.ts:    sidebarCollapsed, theme, commandPaletteOpen, selectedTaskIds, layoutMode
  player-store.ts: currentTime, duration, playing, activeLang, tracks
```

两者不互相渗透：HTTP 响应只进 TanStack Query，纯 UI 交互状态只进 Zustand。
这使得"切换阅读模式时播放不中断"成为可能——`<Player>` 始终 mount，
CSS 控制位置，播放状态在 `player-store` 中持久。

---

## 五种阅读模式（Layout Modes）

单一固定布局无法满足"看视频讲座 / 听播客 / 精读 / 做笔记"等不同注意力中心。

| Mode | 名称 | 默认触发 | 特征 |
|------|------|---------|------|
| A | 视频优先 | `mediaKind = 'video'` | 55% 视频 + 笔记 \| 45% 文章 |
| B | 阅读优先 | 手动 | 全宽文章 \| 320px 视频侧边栏 |
| C | 音频+文章 | `mediaKind = 'audio'` | 72px 音频条 + 字幕列 + 文章 |
| E | 沉浸阅读 | `mediaKind = null` | 全宽文章，无播放器 |
| F | 剧场模式 | 手动 | 全宽视频上方，文章下方 |

实现上，`<Player>` 始终 mount，CSS 控制布局，切换模式不触发 unmount，
因此播放位置、字幕状态均不丢失。

---

## 设计语言：Forest Calm

**强调色 Sage（鼠尾草绿，`#5A8A5A` 系）**，走"森林静谧"路线：低饱和、高可读性。
长时间阅读内容时，鲜艳强调色（蓝/橙）会产生视觉疲劳；Sage 系提供辨识度而不抢夺注意力。

底色保持中性暖灰（浅色 `#F9F8F4`，深色 `#1A1A18`），绿色只用于按钮、链接、激活态、
进度、引用左边线等**点状区域**。跟随系统明暗切换，用户也可在 ⌘K 命令面板手动覆盖。

---

## 鉴权模型

- **安全边界**：Koa 服务绑定 `127.0.0.1`（loopback），这是唯一安全边界
- **Token 下发**：后端启动时生成，通过首屏 HTML `<meta name="vdl-token">` 注入
- **请求方式**：fetch 用 `Authorization: Bearer`；SSE 用 `?token=`（`EventSource` 不支持自定义 header）
- **不做**：cookie / CSRF / 登录 UI / CORS（LAN/远程访问明确不在范围）

本地单用户 + loopback 场景下，`<meta>` token 被第三方脚本读取的风险极低。
若未来引入浏览器扩展或嵌入第三方 widget，需改为 `HttpOnly` cookie。

---

## Electron 并存策略

Web 端稳定前，Electron 壳保留作 fallback：
- `bash start-electron.sh`：Electron `BrowserWindow` 默认 `loadURL('http://127.0.0.1:3000')`（新 Web）
- `/legacy` 路由：旧 Electron renderer 静态托管，用户可手动切回

稳定 2–4 周后，独立 PR 删除 `electron/` 目录与 `/legacy` 路由。

---

## 相关文档

- 后端生命周期与 SSE 被动心跳：[explanation/singleton-backend.md](singleton-backend.md)
- HTTP API 契约：[reference/api.md](../reference/api.md)
- 运行 Web 端：[how-to/run-web.md](../how-to/run-web.md)
