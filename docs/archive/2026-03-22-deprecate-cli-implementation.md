# Deprecate CLI (`scripts/run.sh`) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `scripts/run.sh` 改为薄壳弃用（明确报错 + 替代指引），并把 `scripts/test_full_e2e.sh` 迁到与 `npm run test:agent:e2e` 一致的 HTTP 编排路径；同步更新 README、`CLAUDE.md`、`scripts/install.sh`、`docs/PROJECT_KNOWLEDGE.md`。

**Architecture:** 保留 `run.sh` 路径但不再执行流水线；正式运行时仍仅经 `core/orchestrator` + 分步脚本。全量 e2e 继续由 `tests/agent-service-e2e.test.js` 内嵌 HTTP 服务器驱动，bash 层仅作薄包装。

**Tech Stack:** Bash、`node`、现有 `services/http-server` 与 `tests/agent-service-e2e.test.js`。

**设计依据：** `docs/plans/2026-03-22-deprecate-cli-design.md`

---

### Task 1: 核对 `run.sh` 独有逻辑

**Files:**

- Read: `scripts/run.sh`（全文或关键函数）
- Cross-check: `core/orchestrator/index.js` 调用的 `scripts/*.sh`（如 `download_subs.sh`、`fetch_info.sh` 等）

**Step 1:** 列出 `run.sh` 中与「字幕/转录/下载」相关的分支，确认是否已在对应分步脚本中实现。

**Step 2:** 若发现独有逻辑，在改薄壳 **之前** 将行为合并到目标 `scripts/*.sh`（单处提交或小步提交）。

**Step 3:** Commit（仅当 Task 1 有代码改动时）

```bash
git add scripts/*.sh
git commit -m "fix: align step scripts with former run.sh behavior where needed"
```

---

### Task 2: 将 `scripts/run.sh` 替换为薄壳

**Files:**

- Modify: `scripts/run.sh`（整体替换为短脚本，保留 shebang）

**Step 1:** 备份当前 `run.sh` 逻辑（可选：`git show HEAD:scripts/run.sh > /tmp/run.sh.bak` 或使用 git 历史），然后写入薄壳，内容需包含：

- 说明 CLI 一键入口已废弃；
- 指向 `bash start-electron.sh` / `npm start`、`npm run agent:serve`；
- 指向 `npm run test:agent:e2e`（及环境变量文档见 `tests/agent-service-e2e.test.js` 文件头）；
- 末尾 `exit 1`。

**Step 2:** 语法检查

Run: `bash -n scripts/run.sh`  
Expected: 无输出，退出码 0

**Step 3:** 手动冒烟

Run: `bash scripts/run.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`  
Expected: 打印弃用说明，退出码 1

**Step 4:** Commit

```bash
git add scripts/run.sh
git commit -m "chore(cli): replace run.sh with deprecation stub"
```

---

### Task 3: 迁移 `scripts/test_full_e2e.sh` 至 HTTP e2e

**Files:**

- Modify: `scripts/test_full_e2e.sh`

**Step 1:** 用薄包装替换脚本主体：在仓库根目录执行 `npm run test:agent:e2e`，并默认 `export E2E_PIPELINE_MODE=transcript`（允许调用方覆盖）。使用 `set -euo pipefail` 与 `ROOT`/`cd` 保证路径正确。

示例结构（实施时按仓库风格微调注释）：

```bash
#!/usr/bin/env bash
set -euo pipefail
# Full E2E：已改为经本地 HTTP 编排（与 tests/agent-service-e2e.test.js 一致）。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export E2E_PIPELINE_MODE="${E2E_PIPELINE_MODE:-transcript}"
exec npm run test:agent:e2e
```

**Step 2:** 说明：本测试需外网、yt-dlp、写作引擎；详见 `tests/agent-service-e2e.test.js` 顶部注释。

**Step 3:** Commit

```bash
git add scripts/test_full_e2e.sh
git commit -m "test(e2e): route test_full_e2e.sh through agent-service e2e"
```

---

### Task 4: 更新 `README.md`

**Files:**

- Modify: `README.md`（「命令行使用」小节及任何 `run.sh` 示例）

**Step 1:** 删除或改写为「已废弃」说明，改为：

- 快速开始：`bash start-electron.sh`；
- 自动化/API：`npm run agent:serve` + `docs/PROJECT_KNOWLEDGE.md` 或计划中 HTTP API 小节链接。

**Step 2:** Commit

```bash
git add README.md
git commit -m "docs: remove run.sh as supported entry, point to GUI and agent service"
```

---

### Task 5: 更新 `scripts/install.sh`

**Files:**

- Modify: `scripts/install.sh`（末尾 `echo` 使用提示）

**Step 1:** 将 `bash scripts/run.sh "..."` 示例替换为 GUI / `agent:serve` / `test:agent:e2e`。

**Step 2:** Commit

```bash
git add scripts/install.sh
git commit -m "docs(install): drop run.sh hint after CLI deprecation"
```

---

### Task 6: 更新 `CLAUDE.md`（及仓库内 AGENTS/GEMINI 若存在同类段落）

**Files:**

- Modify: `CLAUDE.md`

**Step 1:** 「执行命令」小节改为以 GUI、Agent Service、HTTP 测试为准；明确 `run.sh` 已废弃。

**Step 2:** Commit

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for deprecated CLI"
```

---

### Task 7: 更新 `docs/PROJECT_KNOWLEDGE.md`

**Files:**

- Modify: `docs/PROJECT_KNOWLEDGE.md`

**Step 1:** 调整架构图 / 「CLI 一键」章节：标明 `run.sh` **已废弃**；主路径仅 GUI + HTTP。

**Step 2:** 排查文内所有 `bash scripts/run.sh` 示例并替换。

**Step 3:** Commit

```bash
git add docs/PROJECT_KNOWLEDGE.md
git commit -m "docs: reflect deprecated run.sh in project knowledge"
```

---

### Task 8: 验证

**Step 1:** 运行（需本机满足 e2e 条件，可跳过若环境无引擎）

Run: `E2E_PIPELINE_MODE=transcript npm run test:agent:e2e`  
Expected: 与改前一致通过或同等失败（环境原因）

**Step 2:** 运行快速测试（不依赖外网时）

Run: `npm run test:agent`  
Expected: PASS

**Step 3:** 如有 CI，确保流水线未再调用 `bash scripts/run.sh`。

---

## 执行交接

Plan complete and saved to `docs/plans/2026-03-22-deprecate-cli-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** — 每任务派生子代理，任务间 review，迭代快  
**2. Parallel Session (separate)** — 新会话使用 superpowers:executing-plans，批量执行带检查点  

Which approach?
