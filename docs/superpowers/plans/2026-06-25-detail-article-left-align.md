# 详情页文章模块大屏左对齐修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将详情页总结/文章内容区域从大屏居中改为左对齐，使其与上方 tab 栏视觉对齐。

**Architecture:** 纯 CSS 单行修复。`.article-notes-row` 的 `margin: 0 auto` 去掉自动水平居中，改为 `margin: 0`；`article-col` 自身 48px 水平内边距与 tab 栏 `px-12` 对齐，各 Mode 的 per-mode `article-col` max-width 继续约束行长。

**Tech Stack:** Tailwind CSS v4，自定义 CSS（`globals.css`），React/TypeScript，Vitest（现有测试套件）

## Global Constraints

- 只改 `web/src/styles/globals.css`，不动 TSX 文件
- 不引入新 CSS 类或变量
- 现有各 Mode（A/B/C/E/F）的布局行为除左对齐外保持不变
- 分支：必须在 `feature/*` 分支上操作，不得在 `master`/`staging` 直接提交

---

### Task 1: 修改 `.article-notes-row` 居中对齐为左对齐

**Files:**
- Modify: `web/src/styles/globals.css:123`

**Interfaces:**
- Consumes: 无
- Produces: `.article-notes-row` CSS 规则中 `margin: 0 auto` → `margin: 0`

- [ ] **Step 1: 确认当前行内容**

  打开 `web/src/styles/globals.css`，定位到约第 119–126 行，确认当前内容：

  ```css
  /* --- Shared: article + notes row --- */
  .article-notes-row {
    display: flex;
    max-width: 1040px;
    margin: 0 auto;
    width: 100%;
  }
  ```

- [ ] **Step 2: 应用修改**

  将 `margin: 0 auto;` 改为 `margin: 0;`，结果：

  ```css
  /* --- Shared: article + notes row --- */
  .article-notes-row {
    display: flex;
    max-width: 1040px;
    margin: 0;
    width: 100%;
  }
  ```

- [ ] **Step 3: 启动 dev server 验证**

  ```bash
  cd web && npm run dev
  ```

  在浏览器打开一个有内容的任务详情页（`/tasks/<id>`），在以下各 Mode 下目测验证：

  | Mode | 验证点 |
  |------|--------|
  | E（沉浸阅读，无媒体）| 文章左边与"总结/文章"tab 文字左边对齐；大屏下无大量左侧空白 |
  | B（阅读优先）| 同上；右侧 320px sidebar 正常显示 |
  | C（音频+文章）| 同上；左侧 280px subtitle-col 正常显示 |
  | A（视频优先）| 左侧视频区与右侧文章区分割正常，无布局错位 |
  | F（剧场模式）| 文章内容左对齐，顶部视频区正常 |

  **预期**：各模式切换流畅，文章左边与 tab 栏对齐，窄屏（≤768px）下无回退问题。

- [ ] **Step 4: 运行现有测试套件确认无回归**

  ```bash
  cd web && npm run test
  ```

  **预期输出**：所有测试通过（pass），无新增失败。

- [ ] **Step 5: 提交**

  ```bash
  git add web/src/styles/globals.css
  git commit -m "fix(web): left-align article-notes-row on wide screens"
  ```
