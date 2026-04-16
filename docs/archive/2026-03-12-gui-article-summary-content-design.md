# GUI Article/Summary 内容接口设计

> 主界面 Article / Summary 面板当前仅占位。本设计在 http-server 增加「返回正文」的只读接口，供 GUI 展示；agent-service 其它场景不依赖此接口。

---

## 1. 目标与范围

- **目标**：GUI 在选中任务后，能请求并展示 `work/<id>/writing/article.md` 与 `summary.md` 的正文。
- **范围**：`services/http-server` 新增 GET content 接口；Electron 渲染进程在 selectTask 或切 tab 时请求并渲染。
- **非目标**：不改变任务创建/执行/状态机；不要求 agent 其它调用方使用此接口。

---

## 2. 接口约定

### 2.1 路径与参数

- **路径**：`GET /api/tasks/:taskId/result/content`
- **Query**：`type`（必填），取值 `article` 或 `summary`。
- **鉴权**：与现有 `/api/tasks` 一致（如 Bearer token 或 query token）。

### 2.2 响应

- **200**：body = 文件原始内容；`Content-Type: text/markdown; charset=utf-8`（或 `text/plain`）。
- **404**：任务不存在或对应文件不存在（步骤未完成/失败）。body 可为简短 JSON `{ "error": "file not found", "type": "article" }` 或纯文本。
- **400**：`type` 缺失或非法（非 article/summary）。
- **401**：鉴权失败，与现有 API 一致。

### 2.3 安全

- 服务端根据 `getTaskResult(taskId)` 得到 `outputs.article_path` / `outputs.summary_path`，仅当路径落在 `rootDir/work/<id>/writing/` 且文件名为 `article.md` 或 `summary.md` 时才读文件并返回，避免路径穿越。

---

## 3. 服务端逻辑（http-server）

- 新增路由：`GET /api/tasks/:taskId/result/content`，解析 query `type`。
- 调用现有 `orchestrator.getTaskResult(taskId, { rootDir })` 获取 `outputs`。
- 根据 `type` 取 `outputs.article_path` 或 `outputs.summary_path`，做路径校验（规范化为绝对路径后检查前缀与文件名），通过则 `fs.readFile` 读文件，设置 `Content-Type` 并返回 body。
- 文件不存在或校验失败：404 或 500，不暴露内部路径。

---

## 4. 前端（Electron 渲染进程）

- 在 `selectTask()` 或切换到 Article/Summary tab 时，使用 ServiceClient 请求：
  `GET /api/tasks/${taskId}/result/content?type=article` 或 `type=summary`。
- 200：将响应文本写入 `#articleOutput` / `#summaryOutput`，若有 Markdown 渲染则复用，否则可先以纯文本展示。
- 非 200：展示占位文案（如「文章尚未生成」或「加载失败」），不阻塞其它 UI。

---

## 5. 错误与边界

- 任务存在但 article/summary 未生成：返回 404，前端显示「未生成」类提示。
- `type` 缺失或非法：400。
- 路径校验失败：500，不暴露内部路径。

---

## 6. 与 agent-service 的关系

- 仅新增只读接口，不改变任务创建、执行、状态机。
- 文档中注明「主要为 GUI 展示用，agent 场景可选使用」。

---

## 7. 参考

- `services/http-server/index.js`：现有 `/tasks/:taskId/result` 路由。
- `core/orchestrator/index.js`：`getTaskResult` 与 `outputs` 结构。
- `electron/src/renderer/index.html`：`articleOutput`、`summaryOutput`、`selectTask()`。
