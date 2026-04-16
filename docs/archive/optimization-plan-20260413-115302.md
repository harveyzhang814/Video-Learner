# Video-Learner 项目优化计划

<!-- /autoplan restore point: /Users/harveyzhang96/.gstack/projects/harveyzhang814-Video-Learner/master-autoplan-restore-20260413-115302.md -->

**Branch:** master | **Date:** 2026-04-13 | **Scope:** 全面代码库审查，识别可优化项

---

## 目标

扫描 Video-Learner 代码库，识别并优先排序可提升可维护性、安全性、开发体验和性能的优化机会。不引入新功能，专注于"把现有代码做得更好"。

---

## 前提假设

1. 项目是单人开发的个人工具（solo mode），没有 SLA 压力
2. 核心功能已稳定（orchestrator DAG、HTTP service、Electron GUI 都通过了测试）
3. 优化不应破坏现有的 API 契约（`/api/tasks`, `/api/events` 等）
4. 目标平台是 macOS（Electron）+ 本地 HTTP 服务

---

## 现状分析

### 代码库规模
- `core/orchestrator/index.js` — 1090 行（主状态机）
- `services/http-server/index.js` — 520 行（Koa REST API）
- `electron/src/renderer/index.html` — 3014 行（单文件 React-like GUI）
- `scripts/` — 2358 行 shell scripts（各 pipeline 步骤）
- `tests/` — 18 个测试文件

### 已识别的优化机会

## 优化项 A：死代码清理（高优先级）

### A1: `electron/src/orchestrator.js`（164行）- 完全孤立的死代码
- 该文件定义了 `class Orchestrator`，包装 `core/orchestrator`
- **在整个代码库中没有任何文件 require 它**（main.js、renderer、preload 都不用）
- 历史遗留：过去 GUI 直接通过此适配器调用 orchestrator，现已全面切换为 HTTP+ServiceClient 架构
- 删除风险：**零**，不会影响任何运行路径

### A2: `electron/src/db.js`（214行）- 被死代码依赖的死代码
- 仅被 `electron/src/orchestrator.js` require，而 A1 本身已是死代码
- 实现了与 `core/orchestrator/db.js` 重叠但不同的 `class DatabaseManager`
- 删除风险：**零**（A1 已是死代码，A2 与之同命运）

### A3: `electron/src/websocket-server.js`（71行）- WebSocket 服务器死代码
- 定义了 WebSocket server，历史上用于 Electron 主进程推送事件
- **没有任何文件 require 它**
- 已被 SSE（`/api/events`）完全替代
- `electron/package.json` 中的 `ws` 依赖也因此变成死依赖

### A4: `scripts/test_ws_e2e.sh`（121行）- 测试死代码路径
- 测试 `ws://localhost:8765`，这个 WebSocket 端口已不再存在
- 依赖 `scripts/test_ws_e2e.sh` 会给开发者造成困惑（这个测试跑不通）

---

## 优化项 B：依赖清理（中优先级）

### B1: `ws` 包从 `electron/package.json` 移除
- 原因：`websocket-server.js` 是死代码（见 A3）
- `ws` 是 `electron/package.json` 的 `dependencies`，每次 `npm install` 都会装入

### B2: `node-fetch` 从根 `package.json` 移除
- Node.js 18+ 已内置 `fetch`，当前运行时 v25.6.1
- 全代码库没有任何文件 `require('node-fetch')`
- 测试文件直接用全局 `fetch`（Node 内置）

---

## 优化项 C：安全加固（见 TODO #1~#4）

（已记录在 Task #1-#4，此处汇总）

### C1: HTTP REST 端点加鉴权（TODO #1）
- `ServiceClient` 发 `Authorization: Bearer token`，服务端不检查
- 所有非 SSE 端点可无凭证访问

### C2: `agent:serve` 绑定 127.0.0.1（TODO #2）
- 当前 `app.listen(port)` 绑定 0.0.0.0

### C3: SQLite `busy_timeout`（TODO #3）
- Electron 双进程共享 SQLite，无 busy_timeout

### C4: `start-electron.sh` pkill 精确化（TODO #4）
- `pkill -f "electron"` 会误杀 VS Code

---

## 优化项 D：技术债/架构（低-中优先级）

### D1: 3 个已合并的 worktree 未清理
- `feature/orchestrator-service-final-state` — 已合并
- `fix/agent-service-test-plan` — 已合并
- `feature/runstep-prerequisites-a` — 已合并
- `.worktrees/` 目录下仍存在这 3 个物理目录，占用磁盘空间并造成混乱

### D2: `electron/src/renderer/index.html` 3014 行单文件
- 所有 CSS + HTML + JS 全在一个 HTML 文件里
- 29 个内联函数，237 处类/函数定义
- 可维护性差，无法单独测试组件逻辑
- 注意：重构范围大（"ocean"），仅建议拆分为独立 JS 模块

### D3: Renderer 依赖外部 CDN `marked.min.js`
- `<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js">`
- Electron 是离线桌面应用，网络中断时 Markdown 渲染失效
- 应 vendor 到本地或通过 npm 安装

### D4: `deleteTask` 仅测试了 `hard` 模式
- `mode=state` 和 `mode=soft` 的删除路径没有测试覆盖
- HTTP DELETE 端点支持 3 种 mode，只有 hard 有专门测试

### D5: `scripts/db.sh` 可能与 orchestrator schema 漂移
- 173 行手动 SQLite CLI 工具
- 如果 orchestrator/db.js 的 schema 变化，db.sh 不会自动同步

---

## 实施策略

### 阶段一：无风险清理（建议优先做）
- A1 + A2 + A3 + A4：删除死代码（0 破坏风险）
- B1 + B2：移除死依赖（0 破坏风险）
- D1：清理已合并 worktree

### 阶段二：安全加固
- C1 + C2 + C3 + C4（已在 TODO #1-#4）

### 阶段三：可维护性提升
- D3：vendor marked.js
- D4：补充 deleteTask state/soft 模式测试
- D5：评估 db.sh 同步策略

### 阶段四：架构重构（可选，长期）
- D2：Renderer 模块化拆分

---

---

## 修订后的实施顺序（基于三阶段审查）

### 阶段一：CDN 修复 + 工作区清理（~30分钟）
1. **D3** — vendor marked.js（`npm install marked --prefix electron`，替换 CDN script tag）
2. **D1** — 清理3个已合并 worktree

### 阶段二：安全加固（~60分钟）
3. **C1** — REST 端点加鉴权（恢复：D3+no-auth = XSS→API 攻击链）
4. **C4** — `pkill -f "electron"` 精确化（最高日常影响）
5. **C2** — `app.listen(port, '127.0.0.1', ...)` 绑定
6. **C3** — `db.pragma('busy_timeout = 3000')` 追加

### 阶段三：死代码清理（~30分钟）
7. **A1** — 删除 `electron/src/orchestrator.js`
8. **A2** — 删除 `electron/src/db.js`（**保留** `better-sqlite3` 在 `electron/package.json`）
9. **A3** — 删除 `electron/src/websocket-server.js` + 移除 `electron/package.json` 中 `ws` dep
10. **A4** — 删除 `scripts/test_ws_e2e.sh`（测试死路径）
11. **B2** — 移除 root `package.json` 中 `node-fetch`（先运行 `npm ls node-fetch` 确认无隐式依赖）

### 阶段四：测试补充（~45分钟）
12. **D4** — 补充 `deleteTask` 测试：`mode=soft`，以及 delete-while-running → 409
13. **C1 测试** — 无鉴权 POST /api/tasks → 401，带鉴权 → 201
14. **C3 测试** — `createDb()` 后验证 `busy_timeout = 3000`

### 明确不做（取消的项目）
- ~~C1 dropped~~ — **恢复**，必须在 D3 之前或同时完成
- B1（root `node-fetch`）— 改为 B2，电子 `ws` 才是要移除的

### 关键注意事项
> **`better-sqlite3` 必须保留在 `electron/package.json`**
> `core/orchestrator/db.js` 由 Electron 主进程加载，Node 模块解析从 `electron/` 开始走。
> 删除 A1/A2 不允许移除 `better-sqlite3`，只移除 `ws`。

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | Mode = SELECTIVE EXPANSION | Mechanical | P3 | 维护计划固定范围，机会性展示 | SCOPE EXPANSION |
| 2 | CEO | Approach A (完整优化) | Mechanical | P1 | 完整度最高，风险低 | B（仅快速赢）|
| 3 | CEO | ~~Drop C1~~ → 恢复 C1 | 已被 Eng 否决 | P1+安全 | D3+无鉴权=XSS攻击链 | 保留 drop |
| 4 | Eng | `better-sqlite3` 保留 electron/package.json | Mechanical | P5 | 核心运行时依赖，不能因死代码删除而连带 | 移除 dep |
| 5 | Eng | C1 恢复为必要步骤 | Mechanical | P1 | 安全漏洞（XSS链）优先于简化 | 保持dropped |
| 6 | DX | test_ws_e2e.sh 加入 A4 删除范围 | Mechanical | P2 | 测试死路径，loud-fail 无价值 | 保留脚本 |

---

## 不在范围内（延期到 TODOS.md）

- 新功能开发（多语言支持、批量任务等）
- 性能优化（目前无明显瓶颈）
- CI/CD 接入（无 `.github/workflows`，暂不引入）
- Renderer 完整框架迁移（React/Vue）— 属于"ocean"，不是"lake"

---

## 成功标准

1. 死代码全部删除，`electron/src/` 下不再有孤立文件
2. `npm install` 不再安装 `ws` 和 `node-fetch`
3. 所有现有测试仍然通过
4. 安全 TODO #1-#4 至少完成 C2 和 C3（高性价比）
5. `.worktrees/` 只保留活跃分支

