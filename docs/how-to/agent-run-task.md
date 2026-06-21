# 如何通过 HTTP API 执行 YouTube 任务（Agent 操作指南）

本文面向 **AI Agent** 或自动化脚本，说明如何调用本地 HTTP Service 完成「YouTube URL → 转录 + 摘要」全流程。

---

## 0. 前置确认

**服务必须已在运行。** Agent 在操作前先检查：

```bash
curl -s http://127.0.0.1:3000/healthz
```

返回 `200 OK` 即可继续。若服务未启动，让用户执行：

```bash
npm run agent:serve
```

> 默认端口 3000，可通过环境变量 `PORT` 调整。

---

## 1. 创建任务

```bash
curl -s -X POST http://127.0.0.1:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://www.youtube.com/watch?v=XXXX",
    "focus": "技术细节与核心架构",
    "mode": "transcript",
    "output_lang": "zh-CN"
  }'
```

### 参数说明

| 字段 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `url` | 是 | — | YouTube URL |
| `focus` | 否 | — | 用户关注点（影响 summary 内容；留空则流水线结束后需人工补填） |
| `mode` | 否 | `media` | `transcript`（仅转录+摘要）\| `audio`（含音频）\| `media`（含视频）\| `full`（含音视频） |
| `output_lang` | 否 | `zh-CN` | 输出语言，如 `en`、`zh-CN` |
| `force` | 否 | `false` | 是否强制重跑已完成的步骤 |
| `timeout_scale` | 否 | `1` | 超时倍率，用于超长视频（见下方「超长视频」一节） |

### 响应

```json
{ "task_id": "a1b2c3d4e5f6" }
```

记录 `task_id`，后续所有操作均通过它引用。

> **幂等性**：同一 URL 得到同一 `task_id`（`sha1(url+'\n').slice(0,12)`）。若任务已存在且完成，可直接查询结果，无需重新创建。

---

## 2. 轮询任务状态

```bash
curl -s http://127.0.0.1:3000/api/tasks/<task_id>
```

关注响应中的 `status` 字段：

| `status` | 含义 |
|----------|------|
| `pending` / `running` | 仍在执行，继续等待 |
| `done` | 流水线完成 |
| `failed` | 整体失败（可查 `steps` 细节） |

**建议轮询间隔**：5 秒，超时上限：普通视频 20 分钟，`--long`（×3）60 分钟，`--ultra-long`（×6）2 小时。

### 快速判断是否完成

```bash
curl -s http://127.0.0.1:3000/api/tasks/<task_id> \
  | jq '{status, transcript_done: .meta.transcript_done, summary_done: .meta.summary_done}'
```

---

## 3. 获取结果

任务 `done` 后：

```bash
# 查看输出文件路径
curl -s http://127.0.0.1:3000/api/tasks/<task_id>/result

# 直接读取摘要（Markdown 正文）
curl -s http://127.0.0.1:3000/api/tasks/<task_id>/result/content?type=summary

# 直接读取文章
curl -s http://127.0.0.1:3000/api/tasks/<task_id>/result/content?type=article
```

产物也直接在磁盘上：

```
work/<task_id>/
├── transcript/original.md      # 带时间戳的逐字稿
└── writing/
    ├── article.md               # 结构化文章
    └── summary.md               # TL;DR + Outline + Key Points + Action Items + Terms
```

---

## 4. 处理特殊情况

### focus 未填时

若创建任务时未提供 `focus`，`meta.focus_needed` 会为 `true`，summary 不会生成。此时需向用户询问关注点，再触发 summary 步骤：

```bash
# 1. 向用户询问 focus（由 Agent 负责）

# 2. 重跑 generate_summary 步骤，并传入 focus
curl -s -X POST http://127.0.0.1:3000/api/tasks/<task_id>/steps/generate_summary/run \
  -H 'Content-Type: application/json' \
  -d '{"focus": "用户提供的关注点", "reset_scope": "step"}'
```

### 某步骤失败时

```bash
# 查看各步骤状态
curl -s http://127.0.0.1:3000/api/tasks/<task_id>/steps

# 重跑失败步骤（不影响其他步骤）
curl -s -X POST http://127.0.0.1:3000/api/tasks/<task_id>/steps/<step_name>/run \
  -H 'Content-Type: application/json' \
  -d '{"reset_scope": "step"}'

# 从某步骤起重跑整条下游流水线
curl -s -X POST http://127.0.0.1:3000/api/tasks/<task_id>/steps/<step_name>/run \
  -H 'Content-Type: application/json' \
  -d '{"reset_scope": "downstream"}'
```

常见步骤名（DAG 内部名）：`fetch`、`subs`、`vtt2md`、`translate`、`md2vtt`、`article`、`summary`、`video`、`audio`、`asr`。

### 超长视频

当用户描述或暗示视频时长较长时，Agent 应主动加上 `timeout_scale`，否则 ASR / LLM 写作步骤可能在完成前被超时终止：

| 用户信号 | 推荐 `timeout_scale` | 等效 CLI |
|---------|---------------------|---------|
| 视频约 1–3 小时、"讲座"、"会议录像"、"播客" | `3` | `--long` |
| 视频 3 小时以上、"超长"、"全天课程" | `6` | `--ultra-long` |
| 用户明确说"用长模式"/"long mode" | `3`（至少） | `--long` |

```bash
# 超长视频示例（timeout_scale=3）
curl -s -X POST http://127.0.0.1:3000/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://www.youtube.com/watch?v=XXXX",
    "focus": "核心论点",
    "mode": "transcript",
    "timeout_scale": 3
  }'
```

**轮询超时上限**也需相应调整：`timeout_scale=3` 时建议将轮询上限从 20 分钟延长至 60 分钟，`timeout_scale=6` 延长至 2 小时。

### 视频下载失败

视频下载失败**不阻塞**转录与摘要流水线。若 `meta.download_status=failed` 但 `transcript_done=true`，流水线仍属正常完成。

---

## 5. 完整示例（Shell 脚本）

```bash
#!/usr/bin/env bash
URL="https://www.youtube.com/watch?v=XXXX"
FOCUS="核心论点与行动项"
BASE="http://127.0.0.1:3000"

# 创建任务
TASK_ID=$(curl -s -X POST "$BASE/api/tasks" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"$URL\",\"focus\":\"$FOCUS\",\"mode\":\"transcript\"}" \
  | jq -r '.task_id')

echo "Task: $TASK_ID"

# 轮询直到完成
for i in $(seq 1 240); do
  STATUS=$(curl -s "$BASE/api/tasks/$TASK_ID" | jq -r '.status')
  echo "[$i] $STATUS"
  [[ "$STATUS" == "done" || "$STATUS" == "failed" ]] && break
  sleep 5
done

# 输出摘要
curl -s "$BASE/api/tasks/$TASK_ID/result/content?type=summary"
```

---

## 相关文档

- [reference/api.md](../reference/api.md) — 完整 HTTP API 路由与 `reset_scope` 语义
- [reference/architecture.md](../reference/architecture.md) — 流水线步骤与 DAG 结构
- [how-to/deploy.md](deploy.md) — 首次部署与依赖安装
