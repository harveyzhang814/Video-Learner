# GUI Article/Summary 内容展示 — 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 http-server 增加 GET result/content 接口，并在 Electron 主界面选中任务时请求并展示 article.md / summary.md 正文。

**Architecture:** 服务端新增 `GET /api/tasks/:taskId/result/content?type=article|summary`，通过 getTaskResult 取路径、校验后 fs.readFile 返回正文；ServiceClient 新增 getTaskContent(taskId, type) 返回文本；渲染进程在 selectTask 或切 tab 时调用并写入 #articleOutput / #summaryOutput，可选 Markdown 渲染。

**Tech Stack:** Koa, Node fs, fetch, 现有 ServiceClient（ESM）。

---

## Task 1: http-server 新增 GET result/content 路由

**Files:**
- Modify: `services/http-server/index.js`（在 router.get('/tasks/:taskId/result') 之后新增路由）

**Step 1: 新增路由与校验逻辑**

在 `router.get('/tasks/:taskId/result', ...)` 之后添加：

```js
router.get('/tasks/:taskId/result/content', async (ctx) => {
  const { taskId } = ctx.params;
  const type = (ctx.query && ctx.query.type) || '';
  if (type !== 'article' && type !== 'summary') {
    ctx.status = 400;
    ctx.body = { error: 'Missing or invalid query: type=article|summary' };
    return;
  }
  try {
    const result = await orchestrator.getTaskResult(taskId, { rootDir: ROOT_DIR });
    const pathKey = type === 'article' ? 'article_path' : 'summary_path';
    const filePath = result.outputs && result.outputs[pathKey];
    if (!filePath || typeof filePath !== 'string') {
      ctx.status = 404;
      ctx.type = 'json';
      ctx.body = { error: 'file not found', type };
      return;
    }
    const workWriting = path.resolve(ROOT_DIR, 'work', result.meta.id, 'writing');
    const normalized = path.normalize(path.isAbsolute(filePath) ? filePath : path.resolve(ROOT_DIR, filePath));
    const allowedArticle = path.join(workWriting, 'article.md');
    const allowedSummary = path.join(workWriting, 'summary.md');
    const allowed = type === 'article' ? allowedArticle : allowedSummary;
    if (normalized !== allowed) {
      ctx.status = 500;
      ctx.body = { error: 'path validation failed' };
      return;
    }
    if (!fs.existsSync(normalized)) {
      ctx.status = 404;
      ctx.type = 'json';
      ctx.body = { error: 'file not found', type };
      return;
    }
    ctx.type = 'text/markdown; charset=utf-8';
    ctx.body = fs.readFileSync(normalized, 'utf8');
  } catch (err) {
    if (/task not found/.test(err.message)) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.type = 'json';
    ctx.body = { error: err.message || 'failed to get content' };
  }
});
```

注意：若 getTaskResult 返回的 outputs 中路径已是绝对路径，需改为与 `path.resolve(ROOT_DIR, ...)` 一致后再做前缀校验，避免误判。当前设计假设 outputs 为相对路径或文件名，上面用 `path.resolve(ROOT_DIR, filePath)`；若实际为绝对路径，则直接用 filePath 做规范化，并校验以 `path.resolve(ROOT_DIR, 'work', result.meta.id, 'writing')` 为前缀且文件名为 article.md 或 summary.md。

**Step 2: 验证**

启动服务后执行：
`curl -s "http://127.0.0.1:PORT/api/tasks/TASK_ID/result/content?type=article" -H "Authorization: Bearer TOKEN"`
对已有 article 的任务应返回 200 与 markdown 内容；对无文件或非法 type 应返回 404/400。

**Step 3: Commit**

```bash
git add services/http-server/index.js
git commit -m "feat(api): GET /api/tasks/:id/result/content for article|summary body"
```

---

## Task 2: ServiceClient 新增 getTaskContent

**Files:**
- Modify: `electron/src/renderer/service-client.js`

**Step 1: 新增方法（返回纯文本，非 JSON）**

在 `getTask(taskId)` 之后添加：

```js
  async getTaskContent(taskId, type) {
    if (type !== 'article' && type !== 'summary') {
      throw new Error('type must be article or summary');
    }
    const url = `${this.baseUrl}/api/tasks/${encodeURIComponent(taskId)}/result/content?type=${encodeURIComponent(type)}`;
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const data = JSON.parse(text);
        if (data && data.error) msg = data.error;
      } catch (_) {}
      throw new Error(`${res.status} ${msg}`);
    }
    return await res.text();
  }
```

**Step 2: 验证**

在浏览器或 Electron 渲染进程控制台中对已挂载的 client 调用 `await client.getTaskContent(taskId, 'article')`，应得到 markdown 字符串。

**Step 3: Commit**

```bash
git add electron/src/renderer/service-client.js
git commit -m "feat(gui): ServiceClient.getTaskContent(taskId, type) for article/summary"
```

---

## Task 3: 渲染进程在 selectTask / tab 切换时请求并展示

**Files:**
- Modify: `electron/src/renderer/index.html`

**Step 1: 在 selectTask 内请求 content 并写入面板**

在现有 `selectTask()` 中，在 `applyTaskToInfo(task)` 之后、设置 `articleOutput.innerHTML` 与 `summaryOutput.innerHTML` 占位之前，增加：

- 对 `client.getTaskContent(taskId, 'article')` 和 `client.getTaskContent(taskId, 'summary')` 分别请求（可用 Promise.all 或顺序 await）。
- 200 时：将返回的文本写入 `articleOutput` / `summaryOutput`。若项目已有 Markdown 渲染（如 marked），则先渲染再写入；否则可先用 `escapeHtml(text)` 或 `textContent` 避免 XSS，或简单用 innerText。
- 捕获异常（404/网络错误）：对应面板显示占位文案，如「文章尚未生成」或「总结尚未生成」。

**Step 2: 可选 — tab 切换时懒加载**

若希望切到 Article/Summary tab 时才请求，可在 tab 点击时检查当前任务是否已加载过 content，未加载则再调 getTaskContent 并写入；否则复用已加载内容。若先实现 selectTask 时一次性加载即可满足需求，可暂不实现懒加载。

**Step 3: 验证**

选中一个已有 article/summary 的任务，主界面 Article / Summary 面板应显示对应内容；选中未生成的任务应显示占位文案。

**Step 4: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): load and show article/summary content in main panel"
```

---

## 执行与验收

- 按 Task 1 → 2 → 3 顺序执行；每步完成后运行现有测试（如 `npm run test:gui`）确保无回归。
- 人工验收：创建任务并跑至 article/summary 步骤完成，选中该任务后主界面 Article / Summary 应显示文件内容。
