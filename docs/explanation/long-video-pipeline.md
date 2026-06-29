# 长视频分块流水线原理

> 面向想理解"为什么要分块、如何分块、合并算法为何如此设计"的读者。
> 操作步骤见 `--long` / `--ultra-long` CLI 选项（`docs/reference/cli.md`）。

---

## 问题背景

`generate_article.sh` 将完整 transcript 一次性喂给 LLM（MiniMax-M2.7 / Claude）。
LLM 的**输出 token 上限**约 4–8K，3h47m 视频的 ~400KB transcript 在约 2:23 处截断，
末句不完整。Summary 步骤有类似问题：`generate_summary.sh` 喂入 6h+ 视频的完整
article（可达 ~100,000 字符），超过 MiniMax 安全输入上限。

两个问题的解法结构相同：**拆 → 各自处理 → 合并**。

---

## Article：分块生成 + Seam 切割合并

### 触发条件

`generate_article.sh` 始终调用 `scripts/chunk_transcript.py` 生成 manifest，再从
manifest 读取 `total_seconds`：

- **`total_seconds` ≥ 3600（60 分钟）**→ 分块路径
- **< 3600** → 旧的单次路径，行为不变

### 分块参数

| 参数 | 值 | 设计理由 |
|------|----|---------|
| chunk_size | 1800 s（30 分钟）| 单块 ~30 分钟内容，LLM 输出不超 token 上限，同时保留足够上下文 |
| overlap | 90 s（1.5 分钟）| 给合并算法缓冲，避免 seam 处内容因时间戳精度丢失 |
| seam_buffer | 30 s | 合并时的容差搜索范围，不扩展选区，仅用于查找切割点 |

### 文件布局

```
work/<task_id>/
├── transcript/
│   ├── original_zh.md
│   └── chunks/
│       ├── manifest.json        ← chunk 边界元数据
│       ├── chunk_001.md         ← transcript 切片
│       └── chunk_002.md
└── writing/
    ├── chunks/
    │   ├── chunk_001_article.md ← 各块独立 article
    │   └── chunk_002_article.md
    └── article.md               ← 合并结果
```

manifest.json 记录每块的 `seam_start/end`（核心边界）和 `slice_start/end`（含 overlap 的实际切片），
让合并层与切片层解耦。

### Per-chunk Prompt 与时间戳约定

每块 article 由 LLM 生成时，在段落行首标注 `[HH:MM:SS]`，供合并阶段定位切割点。
合并完成后这些段落时间戳会被清除，仅保留章节标题的时间戳（`## 标题 [HH:MM:SS]`）。

### Seam 切割合并算法（为何严格不扩展选区）

早期方案用 ±30s 扩展选区，导致相邻两块内容在 seam 附近**重叠**（同一段话出现两次）。
最终算法改为"±30s 仅用于搜索、不扩展选区"：

```
# Chunk N 的截断点：严格不越过 seam_end
cut_ts = last paragraph where ts <= seam_end
if not found:
    cut_ts = last paragraph where ts <= seam_end + 30  ← 容差搜索

# Chunk N+1 的起始点：严格 > cut_ts，保证无重叠
start_ts = first paragraph where ts > cut_ts
if not found:
    start_ts = first paragraph where ts >= seam_end - 30  ← 容差搜索
```

无可用时间戳时，fallback 为按字节比例切割（不阻断流程，记录 warning）。

### 断点续跑

- `transcript/chunks/chunk_N.md` 已存在 → 跳过切片
- `writing/chunks/chunk_N_article.md` 已存在且非空 → 跳过该块 LLM 调用
- 合并步骤每次重新执行（幂等，覆盖 article.md）

---

## Summary：章节感知 Map-Reduce

### 为何不简单地去掉字数限制

旧 `summary_prompt.txt` 硬编码"约 300-500 字"限制，对所有视频都是不必要的质量损失。
对短视频，直接去掉字数限制即可；对 article ≥ 100,000 字符的超长视频，完整
article 本身已超 LLM 安全输入上限，必须分段处理。

### 触发条件

`split_article_sections.py` 解析 article 的 `##` 章节标题，
按以下公式分组成 trunks（逻辑段）：

```python
target = min(6, math.ceil(section_count / 20))
trunk_size = math.ceil(section_count / target)
```

| 章节数 | trunks | 路径 |
|--------|--------|------|
| 0–40 | ≤2 | **单次调用**（删字数限制，其他不变） |
| 41–60 | 3 | **Map-Reduce** |
| 61+ | 4–6 | **Map-Reduce** |

无 `##` 章节标题（fallback）→ 单次调用。

### Map 阶段

每个 trunk → `summary_mini_prompt.txt`（说明"这是第 N/total 段"，无字数限制）
→ `llm_engine.sh` → `writing/chunks/trunk_N_summary.md`。

断点续跑：`trunk_N_summary.md` 存在且非空 → 跳过。

### Reduce 阶段

所有 trunk summaries 拼接 → `summary_reduce_prompt.txt`（综合生成最终 summary）
→ `writing/summary.md`。每次重新执行（幂等）。

### 为何用"章节分组"而非"字符切割"

LLM 在章节边界处更容易保持主题连贯性。按字符切割可能在段落中间截断，
导致 mini-summary 内容碎片化，Reduce 阶段无法识别段落归属。

---

## 相关文档

- CLI 选项 `--long` / `--ultra-long`：[reference/cli.md](../reference/cli.md)
- 流水线总览：[reference/architecture.md](../reference/architecture.md)
