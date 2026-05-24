# GUI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Electron 渲染器 UI：左栏加搜索 + 卡片优化；中间面板聚焦内容；右侧面板拆成「播放/信息」双 tab，Info tab 展示元数据、步骤进度、uploader。

**Architecture:** 后端新增 `uploader` 字段到 DB → fetch_info.sh 存储 → orchestrator 透传到 API；前端 `index.html` 重构 DOM 结构（左栏搜索、中间清理、右侧 tab），JS 更新 `renderHistory()` / `applyTaskToInfo()` 引用新 DOM，不动任何业务逻辑。

**Tech Stack:** SQLite (better-sqlite3), Bash, Node.js (Koa), Electron renderer (vanilla JS + inline CSS)

---

## File Map

| 文件 | 改动 |
|------|------|
| `core/orchestrator/db.js` | 新增 `uploader TEXT` 列 + ALTER TABLE 迁移 |
| `scripts/fetch_info.sh` | UPDATE 语句中写入 `uploader` |
| `core/orchestrator/index.js` | `getTask()` 从 DB row 读取并透传 `uploader` |
| `electron/src/renderer/index.html` | CSS + DOM + JS 全面重构（主改动） |

---

## Task 1: DB schema — 新增 `uploader` 列

**Files:**
- Modify: `core/orchestrator/db.js`

- [ ] **Step 1: 在 CREATE TABLE 语句中加入 `uploader TEXT`**

找到 `core/orchestrator/db.js` 中 `CREATE TABLE IF NOT EXISTS tasks` 块，在 `focus TEXT` 后面加一行：

```js
// core/orchestrator/db.js — CREATE TABLE IF NOT EXISTS tasks 中
// 原来：
      focus TEXT,
// 改为：
      focus TEXT,
      uploader TEXT,
```

- [ ] **Step 2: 加 ALTER TABLE 迁移，兼容已有 DB**

在 `init_db` 或 `initSchema` 函数末尾（在 `CREATE TABLE` 之后）加：

```js
// 迁移：为旧数据库补列（已有列时 ALTER TABLE 会抛异常，需 try/catch）
try {
  db.prepare("ALTER TABLE tasks ADD COLUMN uploader TEXT").run();
} catch (_) {
  // 列已存在，忽略
}
```

找到 `db.js` 中 `init_db` 或执行 `CREATE TABLE` 的函数，确认它在同一个事务或初始化块内，把上面代码加在 `CREATE TABLE tasks` 语句执行之后。

- [ ] **Step 3: 验证 DB 测试不回归**

```bash
node tests/agent-sqlite-persistence.test.js
```

期望：全部 pass，无新报错。

- [ ] **Step 4: Commit**

```bash
git add core/orchestrator/db.js
git commit -m "feat(db): add uploader column to tasks table"
```

---

## Task 2: fetch_info.sh — 持久化 uploader

**Files:**
- Modify: `scripts/fetch_info.sh`

- [ ] **Step 1: 替换 sqlite3 UPDATE 语句，加入 uploader**

找到 `fetch_info.sh` 第 67 行：

```bash
# 原来：
sqlite3 "$DB_PATH" "UPDATE tasks SET title = '$title', duration = '$duration', updated_at = datetime('now') WHERE id = '$ID';"
```

替换为（使用 printf 格式化参数，避免单引号在 uploader 名称中出错）：

```bash
# 改为：
sqlite3 "$DB_PATH" "$(printf "UPDATE tasks SET title = %s, duration = %s, uploader = %s, updated_at = datetime('now') WHERE id = %s;" \
  "$(printf "'%s'" "$(echo "$title" | sed "s/'/''/g")")" \
  "$(printf "'%s'" "$(echo "$duration" | sed "s/'/''/g")")" \
  "$(printf "'%s'" "$(echo "$uploader" | sed "s/'/''/g")")" \
  "$(printf "'%s'" "$(echo "$ID" | sed "s/'/''/g")")")"
```

更简洁的替代写法（推荐，避免嵌套引号混乱）：

```bash
# 改为（推荐）：
_title_esc=$(echo "$title" | sed "s/'/''/g")
_duration_esc=$(echo "$duration" | sed "s/'/''/g")
_uploader_esc=$(echo "$uploader" | sed "s/'/''/g")
sqlite3 "$DB_PATH" "UPDATE tasks SET title = '$_title_esc', duration = '$_duration_esc', uploader = '$_uploader_esc', updated_at = datetime('now') WHERE id = '$ID';"
```

- [ ] **Step 2: 本地验证（可选，需 yt-dlp）**

如果有可用的测试 URL，运行：
```bash
bash scripts/fetch_info.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" /tmp/test-fetch test123
sqlite3 work/database.sqlite "SELECT id, title, uploader FROM tasks WHERE id = 'test123';"
```

期望输出：能看到 uploader 列有值。

- [ ] **Step 3: Commit**

```bash
git add scripts/fetch_info.sh
git commit -m "feat(fetch): persist uploader to DB"
```

---

## Task 3: orchestrator — getTask 透传 uploader

**Files:**
- Modify: `core/orchestrator/index.js:1133-1155`

- [ ] **Step 1: 在 getTask() 中读取并透传 uploader**

找到 `core/orchestrator/index.js` 第 1140 行附近的 `if (row)` 块：

```js
// 原来：
    if (row) {
      if (row.title != null && row.title !== '') task.meta.title = row.title;
      if (row.duration != null && row.duration !== '') task.meta.duration = row.duration;
      if (row.lang != null && row.lang !== '') task.meta.lang = row.lang;
    }
```

改为：

```js
// 改为：
    if (row) {
      if (row.title != null && row.title !== '') task.meta.title = row.title;
      if (row.duration != null && row.duration !== '') task.meta.duration = row.duration;
      if (row.lang != null && row.lang !== '') task.meta.lang = row.lang;
      if (row.uploader != null && row.uploader !== '') task.meta.uploader = row.uploader;
    }
```

- [ ] **Step 2: 确认 db.getTask() 的 SELECT 语句包含 uploader**

在 `core/orchestrator/db.js` 中找到 `getTask` 函数（约第 99 行的 SELECT 语句）：

```js
// 当前：
SELECT id, url, ts, title, lang, duration, output_lang, focus, mode, transcripts, created_at, updated_at
```

改为：

```js
// 改为：
SELECT id, url, ts, title, lang, duration, output_lang, focus, mode, transcripts, uploader, created_at, updated_at
```

- [ ] **Step 3: 运行 GUI 状态测试**

```bash
node tests/gui-logic-state.test.js
```

期望：全部 pass。

- [ ] **Step 4: Commit**

```bash
git add core/orchestrator/index.js core/orchestrator/db.js
git commit -m "feat(orchestrator): expose uploader field in getTask response"
```

---

## Task 4: index.html CSS — 变量 + 左栏 + 右侧 panel tab

**Files:**
- Modify: `electron/src/renderer/index.html` (`:root` 变量块 + `.sidebar` 相关 CSS)

- [ ] **Step 1: 更新 CSS 变量**

找到 `:root` 块，改 sidebar-width：

```css
/* 改：240px → 220px */
--sidebar-width: 220px;
```

- [ ] **Step 2: 更新左栏字体和 history-item 卡片 CSS**

找到 `.history-item .title` 和 `.history-item .meta` 的 CSS，替换为：

```css
/* 替换原来的 .history-item .title 和 .history-item .meta */
.history-item .item-title {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.history-item .item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-item .item-time {
  font-size: 10px;
  color: var(--text-muted);
}

/* status-dot 尺寸缩小 */
.history-item .status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
```

同时删除或注释掉原来的 `.history-item .title` 和 `.history-item .meta` 规则（避免冲突）。

- [ ] **Step 3: 新增 .sidebar-search CSS**

在 `.history-label` CSS 块之前插入：

```css
.sidebar-search {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-alt);
  border: 1px solid var(--border);
  padding: 5px 8px;
}

.search-icon {
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.sidebar-search-input {
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 12px;
  color: var(--text);
  outline: none;
  width: 100%;
}
.sidebar-search-input::placeholder { color: var(--text-muted); }
```

- [ ] **Step 4: 新增右侧面板 panel-tab CSS**

在 `.video-header` CSS 规则之前（或之后）插入：

```css
/* 右侧面板 Tab Strip */
.panel-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-tab {
  flex: 1;
  padding: 10px 0;
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  cursor: pointer;
  border: none;
  background: var(--bg-alt);
  color: var(--text-muted);
  border-bottom: 2px solid transparent;
  transition: all var(--transition);
  letter-spacing: 0.02em;
  font-family: inherit;
}
.panel-tab:hover { color: var(--text); background: var(--bg); }
.panel-tab.active {
  background: var(--bg);
  color: var(--text);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.panel-pane { display: none; flex-direction: column; flex: 1; overflow: hidden; min-height: 0; }
.panel-pane.active { display: flex; }

/* Info Pane 字段样式 */
.info-pane-scroll {
  flex: 1;
  overflow-y: auto;
}

.info-pane-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.info-pane-section-label {
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.info-pane-field { margin-bottom: 8px; }
.info-pane-field:last-child { margin-bottom: 0; }

.info-pane-field-label {
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.info-pane-field-value {
  font-size: 12px;
  color: var(--text);
  line-height: 1.4;
  word-break: break-all;
}
.info-pane-field-value.is-title { font-size: 13px; font-weight: 500; word-break: break-word; }
.info-pane-field-value.is-url   { color: var(--text-muted); font-size: 11px; }
.info-pane-field-value.is-badge { display: inline-block; padding: 2px 7px; border: 1px solid var(--border); font-size: 10px; font-weight: 500; color: var(--text-secondary); }

/* Info pane 内的 status pills（复用原样式，缩小间距） */
.info-pane-section .info-status {
  gap: 4px;
}
```

- [ ] **Step 5: Commit CSS（此时页面可能短暂错位，下一 task 修 DOM）**

```bash
git add electron/src/renderer/index.html
git commit -m "style(renderer): update sidebar dimensions, add panel-tab and info-pane CSS"
```

---

## Task 5: index.html DOM — 左侧列表栏重构

**Files:**
- Modify: `electron/src/renderer/index.html` (`.sidebar` 块，约第 1446-1455 行)

- [ ] **Step 1: 重构左侧列表栏 DOM**

找到当前的 `.sidebar` 块：

```html
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="logo">YouTube Pipeline</div>
      </div>
      <div class="history-label">
        History
        <button class="new-btn" id="newBtn">+ New</button>
      </div>
      <div class="history-list" id="historyList"></div>
    </div>
```

替换为：

```html
    <div class="sidebar">
      <div class="sidebar-header">
        <div class="logo">YouTube Pipeline</div>
        <button class="new-btn" id="newBtn">+ New</button>
      </div>
      <div class="sidebar-search">
        <div class="search-input-wrap">
          <span class="search-icon">⌕</span>
          <input class="sidebar-search-input" id="sidebarSearch" type="text" placeholder="搜索标题…">
        </div>
      </div>
      <div class="history-label">History</div>
      <div class="history-list" id="historyList"></div>
    </div>
```

注意：`#newBtn` 移入 `sidebar-header`（与 logo 同行），移除原来单独的 `history-label` 内的按钮。

- [ ] **Step 2: 验证页面加载不崩溃（打开 Electron 或浏览器）**

```bash
# 快速验证 HTML 结构有效
node -e "const fs = require('fs'); const html = fs.readFileSync('electron/src/renderer/index.html', 'utf8'); console.log('OK, length:', html.length)"
```

期望：输出 `OK, length: <数字>`，无报错。

- [ ] **Step 3: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(renderer): add search bar to left sidebar, move new-btn to header"
```

---

## Task 6: index.html DOM — 中间面板清理

**Files:**
- Modify: `electron/src/renderer/index.html` (`.main` 块，约第 1457-1570 行)

- [ ] **Step 1: 移除 infoSection（标题/URL 信息行）**

找到并删除整个 `#infoSection` div：

```html
<!-- 删除这整块（约第 1467-1490 行）: -->
      <div class="input-section" id="infoSection">
        <div class="info-content" id="infoContent">
          <div class="info-row">
            <span class="info-label">标题</span>
            <span class="info-value info-title" id="infoTitle">-</span>
          </div>
          <div class="info-row">
            <span class="info-value info-url" id="infoUrl">-</span>
          </div>
          <!-- 兼容 JS 的隐藏元信息行：语言 / 时长 / Focus -->
          <div class="info-row meta-extra">
            <span class="info-label">语言</span>
            <span class="info-value" id="infoLang">-</span>
          </div>
          <div class="info-row meta-extra">
            <span class="info-label">时长</span>
            <span class="info-value" id="infoDuration">-</span>
          </div>
          <div class="info-row meta-extra">
            <span class="info-label">Focus</span>
            <span class="info-value" id="infoFocus">-</span>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: 移除 info-status-bar（步骤 pills）**

找到并删除整个 `.info-status-bar` div：

```html
<!-- 删除这整块（约第 1492-1527 行）: -->
      <div class="info-status-bar">
        <div class="info-status" id="infoStatus">
          <span class="status-pill" data-step="fetch">...
          ...（8 个 pill）...
        </div>
      </div>
```

- [ ] **Step 3: 确认 hidden-inputs 保留**

确认 `#hidden-inputs` div 还在（JS 用到了 `#urlInput` 等）：

```html
<!-- 保留这块不动: -->
      <div class="hidden-inputs hidden">
        <input type="text" id="urlInput" />
        <input type="text" id="focusInput" />
        <div class="toggle" id="videoToggle"></div>
      </div>
```

- [ ] **Step 4: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "refactor(renderer): remove info section and status bar from center panel"
```

---

## Task 7: index.html DOM — 右侧面板重构

**Files:**
- Modify: `electron/src/renderer/index.html` (`.video-panel` 块，约第 1574-1607 行)

- [ ] **Step 1: 替换右侧面板 DOM**

找到整个 `.video-panel` div（从 `<div class="video-panel">` 到其闭合 `</div>`），替换为：

```html
    <div class="video-panel" id="videoPanel">

      <!-- Tab Strip -->
      <div class="panel-tabs" id="panelTabs">
        <button class="panel-tab active" data-panel="player">播放</button>
        <button class="panel-tab" data-panel="info">信息</button>
      </div>

      <!-- 播放 tab -->
      <div class="panel-pane active" id="playerPane">
        <div class="video-container">
          <video id="videoPlayer" class="hidden"></video>
          <div class="video-empty" id="videoEmpty">
            <div class="video-empty-icon">▶</div>
            <div>No video</div>
          </div>
        </div>
        <div class="video-controls">
          <button class="video-btn" id="playPauseBtn">▶</button>
          <button class="video-btn" id="stopBtn">■</button>
          <input type="range" class="video-progress" id="progressBar" value="0" min="0" max="100">
          <span class="video-time" id="timeDisplay">0:00 / 0:00</span>
        </div>
        <div class="video-resizer" id="videoResizer"></div>
        <div class="subtitle-module hidden" id="subtitleModule">
          <div class="subtitle-header">
            <span class="subtitle-header-label">Subtitle</span>
            <div class="language-switcher" id="languageSwitcher">
              <button class="active" data-lang="zh">中文</button>
              <button data-lang="en">English</button>
            </div>
            <select class="hidden" id="subtitleTrackSelect"></select>
            <label class="checkbox-label" style="margin-left: 8px;">
              <input type="checkbox" id="onScreenSubtitleToggle">
              <span class="checkbox-custom"></span>
              <span>画面内字幕</span>
            </label>
          </div>
          <div class="subtitle-list" id="subtitleList"></div>
        </div>
        <div class="video-placeholder"></div>
      </div>

      <!-- 信息 tab -->
      <div class="panel-pane" id="infoPane">
        <div class="info-pane-scroll">

          <!-- 视频信息 -->
          <div class="info-pane-section">
            <div class="info-pane-section-label">视频信息</div>
            <div class="info-pane-field">
              <div class="info-pane-field-label">标题</div>
              <div class="info-pane-field-value is-title" id="infoTitle">-</div>
            </div>
            <div class="info-pane-field">
              <div class="info-pane-field-label">创作者</div>
              <div class="info-pane-field-value" id="infoUploader">-</div>
            </div>
            <div class="info-pane-field">
              <div class="info-pane-field-label">URL</div>
              <div class="info-pane-field-value is-url" id="infoUrl">-</div>
            </div>
            <div class="info-pane-field">
              <div class="info-pane-field-label">时长</div>
              <div class="info-pane-field-value" id="infoDuration">-</div>
            </div>
          </div>

          <!-- 任务配置 -->
          <div class="info-pane-section">
            <div class="info-pane-section-label">任务配置</div>
            <div class="info-pane-field">
              <div class="info-pane-field-label">输出语言</div>
              <div class="info-pane-field-value" id="infoLang">-</div>
            </div>
            <div class="info-pane-field">
              <div class="info-pane-field-label">关注点</div>
              <div class="info-pane-field-value" id="infoFocus">-</div>
            </div>
          </div>

          <!-- 处理进度 -->
          <div class="info-pane-section">
            <div class="info-pane-section-label">处理进度</div>
            <div class="info-status" id="infoStatus">
              <span class="status-pill" data-step="fetch">
                <span class="icon">○</span>
                <span class="label">获取信息</span>
              </span>
              <span class="status-pill" data-step="video">
                <span class="icon">○</span>
                <span class="label">视频下载</span>
              </span>
              <span class="status-pill" data-step="audio">
                <span class="icon">○</span>
                <span class="label">音频下载</span>
              </span>
              <span class="status-pill" data-step="subs">
                <span class="icon">○</span>
                <span class="label">字幕下载</span>
              </span>
              <span class="status-pill" data-step="vtt2md">
                <span class="icon">○</span>
                <span class="label">转换文案</span>
              </span>
              <span class="status-pill" data-step="md2vtt">
                <span class="icon">○</span>
                <span class="label">字幕生成</span>
              </span>
              <span class="status-pill" data-step="article">
                <span class="icon">○</span>
                <span class="label">文章生产</span>
              </span>
              <span class="status-pill" data-step="summary">
                <span class="icon">○</span>
                <span class="label">提炼总结</span>
              </span>
            </div>
          </div>

          <!-- 时间戳 -->
          <div class="info-pane-section">
            <div class="info-pane-section-label">时间</div>
            <div class="info-pane-field">
              <div class="info-pane-field-label">创建</div>
              <div class="info-pane-field-value" id="infoCreatedAt">-</div>
            </div>
            <div class="info-pane-field">
              <div class="info-pane-field-label">更新</div>
              <div class="info-pane-field-value" id="infoUpdatedAt">-</div>
            </div>
          </div>

          <!-- TODO：待存 DB 后展示 -->
          <div class="info-pane-section" style="background: var(--bg-alt);">
            <div class="info-pane-section-label">待补充（需存入 DB）</div>
            <div style="display:flex;flex-direction:column;gap:5px;">
              <div style="font-size:11px;color:var(--text-muted);">○ 发布日期 <code style="font-size:10px;background:var(--border);padding:1px 4px;">upload_date</code></div>
              <div style="font-size:11px;color:var(--text-muted);">○ 播放量 <code style="font-size:10px;background:var(--border);padding:1px 4px;">view_count</code></div>
              <div style="font-size:11px;color:var(--text-muted);">○ 点赞数 <code style="font-size:10px;background:var(--border);padding:1px 4px;">like_count</code></div>
              <div style="font-size:11px;color:var(--text-muted);">○ 视频简介 <code style="font-size:10px;background:var(--border);padding:1px 4px;">description</code></div>
              <div style="font-size:11px;color:var(--text-muted);">○ 封面缩略图 <code style="font-size:10px;background:var(--border);padding:1px 4px;">thumbnail</code></div>
              <div style="font-size:11px;color:var(--text-muted);">○ 分辨率/帧率 <code style="font-size:10px;background:var(--border);padding:1px 4px;">width·height·fps</code></div>
            </div>
          </div>

        </div>
      </div>

    </div>
```

- [ ] **Step 2: 确认所有原有 ID 存在**

运行以下命令检查关键 ID 都在文件中：

```bash
for id in videoPlayer videoEmpty playPauseBtn stopBtn progressBar timeDisplay videoResizer subtitleModule subtitleList languageSwitcher subtitleTrackSelect onScreenSubtitleToggle infoTitle infoUrl infoLang infoDuration infoFocus infoStatus; do
  grep -c "id=\"$id\"" electron/src/renderer/index.html | grep -q "^1$" && echo "OK: $id" || echo "MISSING/DUPLICATE: $id"
done
```

期望：全部输出 `OK: <id>`。

- [ ] **Step 3: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(renderer): restructure right panel with player/info tabs, move info fields to info tab"
```

---

## Task 8: index.html JS — renderHistory、applyTaskToInfo、tab 切换、搜索过滤

**Files:**
- Modify: `electron/src/renderer/index.html` (`<script type="module">` 块)

- [ ] **Step 1: 新增 DOM 引用**

在 `<script>` 块顶部的 DOM 引用区域（约第 1767-1831 行），在现有引用之后加：

```js
const sidebarSearch = document.getElementById('sidebarSearch');
const panelTabs = document.getElementById('panelTabs');
const infoUploader = document.getElementById('infoUploader');
const infoCreatedAt = document.getElementById('infoCreatedAt');
const infoUpdatedAt = document.getElementById('infoUpdatedAt');
```

- [ ] **Step 2: 更新 renderHistory() — 新卡片结构 + 状态圆点**

找到 `renderHistory(tasks)` 函数（约第 2054-2077 行），把内部 `historyList.innerHTML = tasks.map(...)` 替换为：

```js
function renderHistory(tasks) {
  if (!tasks || tasks.length === 0) {
    historyList.innerHTML = '<div style="padding: 16px; color: #999; font-size: 12px;">No history</div>';
    return;
  }
  historyList.innerHTML = tasks
    .map((t) => {
      const id = t.id || t.task_id || t.taskId;
      const title = t.title || (t.url ? t.url.slice(0, 60) : 'Untitled');
      const ts = t.created_at || t.ts || t.updated_at || '';
      const dateStr = ts ? new Date(ts).toLocaleDateString() : '';
      const status = t.status || 'unknown';
      const dotClass = ['running', 'completed', 'failed', 'aborted'].includes(status) ? status : 'unknown';
      return `
        <div class="history-item ${id === currentTaskId ? 'active' : ''}" data-id="${id}">
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="item-meta">
            <span class="item-time">${escapeHtml(dateStr)}</span>
            <span class="status-dot ${dotClass}"></span>
          </div>
        </div>
      `;
    })
    .join('');

  document.querySelectorAll('.history-item').forEach((item) => {
    item.addEventListener('click', () => selectTask(item.dataset.id));
  });
}
```

- [ ] **Step 3: 更新 applyTaskToInfo() — 加 uploader / createdAt / updatedAt**

找到 `applyTaskToInfo(task)` 函数（约第 1973-2007 行），在 `infoTitle.textContent = ...` 等赋值后加：

```js
function applyTaskToInfo(task) {
  const meta = (task && task.meta) || {};
  infoTitle.textContent = meta.title || '-';
  if (infoUploader) infoUploader.textContent = meta.uploader || '-';
  infoUrl.textContent = meta.url || '-';
  infoLang.textContent = meta.output_lang || meta.lang || '-';
  infoDuration.textContent = meta.duration ? formatDuration(Number(meta.duration)) : '-';
  infoFocus.textContent = meta.focus || '-';
  if (infoCreatedAt) infoCreatedAt.textContent = task.created_at ? new Date(task.created_at).toLocaleString() : '-';
  if (infoUpdatedAt) infoUpdatedAt.textContent = task.updated_at ? new Date(task.updated_at).toLocaleString() : '-';

  const steps = task && task.steps ? task.steps : {};
  for (const step of STEPS) {
    const s = steps[step] && steps[step].status ? steps[step].status : 'pending';
    const ui =
      s === 'running' ? 'active' : s === 'completed' || s === 'skipped' ? 'done' : s === 'failed' ? 'error' : 'pending';
    setPillState('#infoStatus', step, ui);
    const pill = document.querySelector(`#infoStatus .status-pill[data-step="${step}"]`);
    if (pill) {
      if (ui === 'error') {
        pill.classList.add('clickable');
        pill.setAttribute('title', '重试');
        let hint = pill.querySelector('.retry-hint');
        if (!hint) {
          hint = document.createElement('span');
          hint.className = 'retry-hint';
          hint.textContent = '重试';
          pill.appendChild(hint);
        }
      } else {
        pill.classList.remove('clickable');
        pill.removeAttribute('title');
        const hint = pill.querySelector('.retry-hint');
        if (hint) hint.remove();
      }
    }
  }
}
```

同时新增 `formatDuration` 辅助函数（在 `applyTaskToInfo` 之前插入）：

```js
function formatDuration(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 新增右侧面板 tab 切换 JS**

在 `<script>` 块末尾（在 `</script>` 之前），加入：

```js
// 右侧面板 tab 切换（播放 / 信息）
if (panelTabs) {
  panelTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.panel-tab');
    if (!btn) return;
    panelTabs.querySelectorAll('.panel-tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    const panel = btn.dataset.panel;
    document.querySelectorAll('.panel-pane').forEach((p) => p.classList.remove('active'));
    const target = document.getElementById(panel === 'player' ? 'playerPane' : 'infoPane');
    if (target) target.classList.add('active');
  });
}
```

- [ ] **Step 5: 新增搜索过滤 JS**

在 panel tab 切换代码之后加：

```js
// 左侧搜索过滤
if (sidebarSearch) {
  sidebarSearch.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll('#historyList .history-item').forEach((item) => {
      const title = (item.querySelector('.item-title') || item).textContent.toLowerCase();
      item.style.display = q === '' || title.includes(q) ? '' : 'none';
    });
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(renderer): update renderHistory card layout, applyTaskToInfo with uploader, panel tabs, search filter"
```

---

## Task 9: 测试 + 最终验证

- [ ] **Step 1: 运行全套 GUI 测试**

```bash
npm run test:gui
```

期望输出（每行）：
```
M4 sanitizeLogLine: ok
M1/M3/M5 startLocalHttpService: ok
...
gui-logic-state.test.js: all passed
```

全部 pass，无报错。

- [ ] **Step 2: 运行 DB 相关测试**

```bash
node tests/agent-sqlite-persistence.test.js
```

期望：pass。

- [ ] **Step 3: 手动验证 checklist**

启动 Electron：

```bash
bash start-electron.sh
```

验证项：

| 场景 | 期望 |
|------|------|
| 左栏搜索框 | 输入关键词实时过滤任务卡片 |
| 任务卡片 | 第一行标题（截断），第二行左时间戳 + 右状态圆点 |
| 右侧「信息」tab | 点击后显示 Info Pane，标题/创作者/URL/时长/步骤进度/时间戳 |
| 右侧「播放」tab | 点击后恢复视频+字幕视图 |
| uploader 字段 | 处理过的任务在信息 tab 「创作者」行显示频道名 |
| 步骤 pills | 状态与任务实际进度同步（运行中显示黄色动画） |
| 中间面板 | 无 Info Section，无 Status Bar；只有工具栏 + Article/Summary |
| `npm run test:gui` | 所有 pass |

- [ ] **Step 4: 最终 commit（若有遗漏修复）**

```bash
git add -A
git commit -m "fix(renderer): post-review adjustments"
```
