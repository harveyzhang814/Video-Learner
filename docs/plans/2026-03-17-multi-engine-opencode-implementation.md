# Multi-Engine Writing (Claude + OpenCode) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `article.md` / `summary.md` 的生成从单一 `claude` CLI 扩展为多引擎（`claude` / `opencode`），其中 OpenCode 通过 `opencode serve + HTTP` 自动启动/自动关闭实现 headless 调用，模型固定 `minimax-cn-coding-plan/MiniMax-M2.5`。

**Architecture:** 新增 `scripts/llm_engine.sh` 作为统一写作引擎适配层；OpenCode 引擎分支内部负责 `opencode serve` 生命周期管理与 HTTP 调用（`/global/health`、`/session`、`/session/:id/message`），并把返回 `parts[].text` 拼接成最终 Markdown 输出。上层 `scripts/run.sh`、`scripts/generate_article.sh`、`scripts/generate_summary.sh` 改为统一调用适配层。

**Tech Stack:** bash、curl、jq、opencode serve HTTP API、Claude Code CLI。

---

## Task 1: 写一个会失败的 OpenCode smoke test（serve + HTTP）

**Files:**
- Create: `scripts/test_opencode_smoke.sh`

**Step 1: 新建 smoke test 脚本（先写最小版）**

脚本行为（先不做优雅日志）：
- 启动 `opencode serve`（端口固定 4097，host=127.0.0.1）
- `GET /global/health` 通过则继续
- `POST /session` 创建 session
- `POST /session/:id/message` 发送 `Reply with exactly: OK`
  - `model` 必须是对象：`{providerID, modelID}`
- 从响应 JSON 中提取 `parts[].text`，拼接并 trim
- 断言结果严格等于 `OK`，否则退出码非 0
- 退出前 kill 掉本次启动的 server

（此时还没有 `llm_engine.sh`，先在 test 里直写 HTTP 调用，确保链路可测。）

**Step 2: 运行测试，确认在当前代码下 FAIL（预期是脚本不存在/不可执行）**

Run:

```bash
bash scripts/test_opencode_smoke.sh
```

Expected:
- 退出码非 0（因为脚本尚未创建或未实现）。

**Step 3: 补齐实现后再次运行（本 Task 结束时应 PASS）**

Run:

```bash
bash scripts/test_opencode_smoke.sh
```

Expected:
- stdout 打印 `OK`（或打印包含 OK 的结果）
- 退出码 0

**Step 4: Commit**

```bash
git add scripts/test_opencode_smoke.sh
git commit -m "test(opencode): add serve+http smoke test"
```

---

## Task 2: 新增 OpenCode server 生命周期管理脚本（自动启动/自动关闭）

**Files:**
- Create: `scripts/opencode_server.sh`

**Step 1: 写一个“健康检查 + 启动 + 记录 PID”的脚本函数**

提供最少两个可调用入口（bash source 方式）：
- `opencode_server_ensure`：确保 `http://127.0.0.1:${OPENCODE_PORT:-4097}` 可用；若不可用则后台启动 `opencode serve`
- `opencode_server_stop_if_started`：若本次进程启动过 server（有 PID 文件/变量）则 kill

建议约定：
- PID 文件：`work/.opencode-serve.pid`
- 健康检查：`curl -fsS --max-time 2 "$base/global/health"`
- 启动命令（不启用 basic auth）：
  - `OPENCODE_SERVER_PASSWORD="" opencode serve --hostname 127.0.0.1 --port "$port" --log-level INFO`
- 等待启动：循环 10 次 * 0.5s（最多 5s），每次 health check

**Step 2: 写一个最小自测（不引入额外框架）**

Run:

```bash
source scripts/opencode_server.sh
opencode_server_ensure
curl -fsS http://127.0.0.1:4097/global/health
opencode_server_stop_if_started
```

Expected:
- health 返回 `{"healthy":true,...}`
- stop 后端口不再监听（可选：`curl` 失败）

**Step 3: Commit**

```bash
git add scripts/opencode_server.sh
git commit -m "feat(opencode): manage serve lifecycle for writing engine"
```

---

## Task 3: 新增统一引擎适配层 `llm_engine.sh`（先写测试，再实现）

**Files:**
- Create: `scripts/llm_engine.sh`
- Modify: `scripts/test_opencode_smoke.sh`（把直写 HTTP 调用改为走 `llm_engine.sh`）

**Step 1: 更新 smoke test 让它调用 `llm_engine.sh`（此时应 FAIL）**

把 `scripts/test_opencode_smoke.sh` 改为：
- 构造 prompt 文件（temp）
- 调用：
  - `WRITING_ENGINE=opencode bash scripts/llm_engine.sh --input "$prompt" --output "$out"`
- 校验 `$out` 内容严格等于 `OK`

Run:

```bash
bash scripts/test_opencode_smoke.sh
```

Expected:
- FAIL（因为 `llm_engine.sh` 还没实现）

**Step 2: 实现 `llm_engine.sh` 的 OpenCode 分支（最小实现）**

接口建议（保持简单）：
- 输入：
  - `WRITING_ENGINE`：`claude`/`opencode`，默认 `claude`
  - 参数：
    - `--input <prompt_file>`
    - `--output <output_file>`
- OpenCode 分支行为：
  - `source scripts/opencode_server.sh`
  - `opencode_server_ensure`
  - `POST /session`（title 可固定 `video-learner-writing`）
  - `POST /session/:id/message`
    - `parts`: `[{type:"text", text: <prompt全文>}]`
    - `model`: `{providerID:"minimax-cn-coding-plan", modelID:"MiniMax-M2.5"}`
  - 提取 `parts[].text` 并写入 output
  - `opencode_server_stop_if_started`

**Step 3: 运行 smoke test，确认 PASS**

Run:

```bash
bash scripts/test_opencode_smoke.sh
```

Expected:
- PASS

**Step 4: Commit**

```bash
git add scripts/llm_engine.sh scripts/test_opencode_smoke.sh
git commit -m "feat(writing): add llm_engine with opencode serve+http"
```

---

## Task 4: 为 `llm_engine.sh` 加入 Claude 分支（保持现状行为）

**Files:**
- Modify: `scripts/llm_engine.sh`

**Step 1: 实现 `WRITING_ENGINE=claude` 分支**

行为对齐现有脚本：
- `unset CLAUDECODE`
- `env ANTHROPIC_BASE_URL="https://api.anthropic.com" claude -p --dangerously-skip-permissions < "$prompt" > "$output"`

**Step 2: 手工冒烟（不要求真正跑模型）**

Run:

```bash
WRITING_ENGINE=claude bash scripts/llm_engine.sh --input scripts/summary_prompt.txt --output /tmp/llm_engine_claude_out.txt
```

Expected:
- 若本机 claude 可用则会输出内容；若不可用至少应给出清晰错误并退出非 0（不应静默成功）。

**Step 3: Commit**

```bash
git add scripts/llm_engine.sh
git commit -m "feat(writing): add claude branch to llm_engine"
```

---

## Task 5: 改造 `scripts/generate_article.sh` 走 `llm_engine.sh`

**Files:**
- Modify: `scripts/generate_article.sh`

**Step 1: 写一个最小回归检查（不需要真实 LLM）**

在本 Task 中，我们用“是否调用 `llm_engine.sh`”作为验证点（通过 `set -x` 或临时 echo 标记），实现后再手动跑一次生成（如果 LLM 可用）。

**Step 2: 替换原有 `claude -p ...` 调用**

将：
- `env ... claude -p ... < "$TEMP_PROMPT" > "$OUTPUT_PATH"`

替换为：
- `WRITING_ENGINE=${WRITING_ENGINE:-claude} bash "$SCRIPT_DIR/llm_engine.sh" --input "$TEMP_PROMPT" --output "$OUTPUT_PATH"`

**Step 3: 跑脚本参数校验与错误分支**

Run:

```bash
bash scripts/generate_article.sh /no/such/file /tmp/out.md
```

Expected:
- 退出码非 0，错误信息保持原有语义。

**Step 4: Commit**

```bash
git add scripts/generate_article.sh
git commit -m "refactor(writing): route article generation via llm_engine"
```

---

## Task 6: 改造 `scripts/generate_summary.sh` 走 `llm_engine.sh`

**Files:**
- Modify: `scripts/generate_summary.sh`

**Step 1: 替换原有 `claude -p ...` 调用为 `llm_engine.sh`**

将：
- `env ... claude -p ... < "$TEMP_PROMPT" > "$OUTPUT_PATH"`

替换为：
- `WRITING_ENGINE=${WRITING_ENGINE:-claude} bash "$SCRIPT_DIR/llm_engine.sh" --input "$TEMP_PROMPT" --output "$OUTPUT_PATH"`

**Step 2: 跑脚本参数校验**

Run:

```bash
bash scripts/generate_summary.sh /no/such/article "focus" /tmp/out.md
```

Expected:
- 退出码非 0，错误信息保持原有语义。

**Step 3: Commit**

```bash
git add scripts/generate_summary.sh
git commit -m "refactor(writing): route summary generation via llm_engine"
```

---

## Task 7: 改造 `scripts/run.sh`（STEP 3.5 / STEP 4）走 `llm_engine.sh`

**Files:**
- Modify: `scripts/run.sh`（约 `STEP 3.5` 与 `STEP 4` 的内联 prompt 生成段）

**Step 1: Article 段替换**

将内联：
- `article_prompt=$(sed ...)`
- `echo "$article_prompt" | ... claude -p ... > "$DIR/writing/article.md"`

替换为：
- 仍然用 `sed` 生成 prompt（可保留变量），但改为写入 temp prompt 文件
- 调用：
  - `WRITING_ENGINE=${WRITING_ENGINE:-claude} bash "$SCRIPT_DIR/llm_engine.sh" --input "$temp_prompt" --output "$DIR/writing/article.md"`

**Step 2: Summary 段替换**

同理，把 `summary_prompt` 写到 temp 文件后调用 `llm_engine.sh` 输出到 `$DIR/writing/summary.md`。

**Step 3: 用现有 transcript-only 测试验证不受影响**

Run:

```bash
bash scripts/test_full_e2e.sh
```

Expected:
- PASS（因为该测试跑 `MODE=get_transcript`，不会进入写作步骤；但我们必须确保改动不破坏整体脚本）

**Step 4: Commit**

```bash
git add scripts/run.sh
git commit -m "refactor(writing): route run.sh writing steps via llm_engine"
```

---

## Task 8: 文档与可用性说明（最小补充）

**Files:**
- Modify: `CLAUDE.md`（新增一段“多引擎写作开关”说明）

**Step 1: 增加用法说明**

补充：
- 默认仍是 Claude：无需设置
- 使用 OpenCode：

```bash
WRITING_ENGINE=opencode bash scripts/run.sh "<URL>" MODE=full_flow_transcript FOCUS="..."
```

并提示：
- 需要本机已配置 OpenCode MiniMax credential
- OpenCode 模型固定：`minimax-cn-coding-plan/MiniMax-M2.5`

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document WRITING_ENGINE=opencode usage"
```

---

## Task 9: 最终验证（手动）

**Step 1: 跑 OpenCode smoke test**

Run:

```bash
bash scripts/test_opencode_smoke.sh
```

Expected:
- PASS

**Step 2: 跑 transcript-only E2E**

Run:

```bash
bash scripts/test_full_e2e.sh
```

Expected:
- PASS

**Step 3: 手动跑一次写作（若环境允许）**

选择一个已有 transcript 的 task（或先跑 `MODE=get_transcript` 生成），再运行：

```bash
WRITING_ENGINE=opencode bash scripts/run.sh "<URL>" MODE=full_flow_transcript FOCUS="技术细节"
```

Expected:
- `work/<id>/writing/article.md`、`work/<id>/writing/summary.md` 生成成功（内容非空）

---

## 执行交接

Plan complete and saved to `docs/plans/2026-03-17-multi-engine-opencode-implementation.md`.

Two execution options:

1. **Subagent-Driven (this session)** — 我在当前会话按 Task 逐个执行、每步 review。
2. **Parallel Session (separate)** — 你开一个新会话，用 `executing-plans` 按任务批量推进。

你选 1 或 2？

