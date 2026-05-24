# Article Chunking 设计文档

**日期**：2026-05-24  
**分支**：feature/long-video-timeout  
**问题**：Transcript ≥ 60 分钟时，MiniMax-M2.7 输出 token 上限导致 article.md 被截断

---

## 背景

当前 `generate_article.sh` 将完整 transcript 一次性喂给 LLM（opencode/MiniMax-M2.7）。
MiniMax 的输出 token 上限约 4–8K，3h47m 视频的 396KB transcript 在约 2:23 处截断，且末句不完整。

---

## 目标

- **完整性**：超长视频（≥ 60 分钟）的 article.md 覆盖全部 transcript 内容
- **向后兼容**：< 60 分钟视频走旧路径，行为不变
- **可恢复**：单个 chunk LLM 调用失败后可断点续跑，已完成 chunk 不重跑

---

## 方案：分块生成 + 时间戳匹配合并

### 1. 触发条件

`generate_article.sh` 始终调用 `chunk_transcript.py` 生成 manifest.json，
再从 manifest 读取 `total_seconds` 决定走哪条路径：

```bash
python3 scripts/chunk_transcript.py "$ORIGINAL_PATH" "$CHUNK_DIR"
total_seconds=$(python3 -c "import json; print(json.load(open('$MANIFEST'))['total_seconds'])")
if [ "$total_seconds" -ge 3600 ]; then
    run_chunked_path   # ≥ 60 分钟
else
    run_single_path    # 旧路径，不改
fi
```

`chunk_transcript.py` 单一职责：始终输出 manifest.json 和切片文件。
无 `--duration` 双模式（D2 决定）。

### 2. 分块参数

| 参数 | 值 |
|------|----|
| chunk_size | 1800 秒（30 分钟） |
| overlap | 90 秒（1.5 分钟） |
| seam_buffer | 30 秒（合并时容差，仅用于搜索，不扩展选区） |

Chunk N 的边界（N 从 0 起）：

| 字段 | 含义 | 计算 |
|------|------|------|
| `seam_start` | 核心起点（合并决策点） | `N × 1800` |
| `seam_end` | 核心终点 | `(N+1) × 1800` |
| `slice_start` | 实际切片起点（含前缓存） | `max(0, seam_start - 90)` |
| `slice_end` | 实际切片终点（含后缓存） | `min(total, seam_end + 90)` |

### 3. 文件布局

```
work/<task_id>/
├── transcript/
│   ├── original_zh.md            ← 原始 transcript（不改）
│   └── chunks/
│       ├── manifest.json         ← chunk 边界元数据
│       ├── chunk_001.md          ← transcript 切片
│       └── chunk_002.md
└── writing/
    ├── chunks/
    │   ├── chunk_001_article.md  ← 各块独立 article
    │   └── chunk_002_article.md
    ├── article.md                ← 最终合并结果
    └── summary.md
```

manifest.json 结构：

```json
{
  "total_seconds": 13674,
  "chunk_size": 1800,
  "overlap": 90,
  "chunks": [
    {
      "index": 1,
      "seam_start": 0,
      "seam_end": 1800,
      "slice_start": 0,
      "slice_end": 1890,
      "transcript_file": "chunk_001.md"
    }
  ]
}
```

### 4. Per-chunk Prompt

在 `article_prompt.txt` 内容前追加上下文头（chunk 模式专用）：

```
【分段处理】完整视频时长 {HH:MM:SS}，本段为第 {N}/{total} 块
（核心范围 {seam_start}–{seam_end}，含 1.5 分缓冲区 {slice_start}–{slice_end}）。
合并要求：每个正文段落前必须标注时间戳，格式 `[HH:MM:SS]`（取该段第一句话的时间）。
```

段落时间戳仅在合并阶段使用，最终 article.md 中会被去除（仅保留章节标题时间戳）。

### 5. 合并算法（merge_article_chunks.py）

**严格 seam 切割**（D1 修正：±30s 只作容差搜索，不扩展选区，避免重复内容）：

```
# 找 chunk N 的切断点（严格不越过 seam_time）
cut_ts = last paragraph in chunk_N where ts <= seam_time
if not found:
    cut_ts = last paragraph in chunk_N where ts <= seam_time + 30  # 容差搜索

# 找 chunk N+1 的起始点（严格 > cut_ts，保证无重叠）
start_ts = first paragraph in chunk_N+1 where ts > cut_ts
if not found:
    start_ts = first paragraph in chunk_N+1 where ts >= seam_time - 30  # 容差搜索
```

时间戳解析覆盖两种格式：
- 段落行首：`[HH:MM:SS]`
- 章节标题：`## 话题A [HH:MM:SS]` 或 `## 话题A [HH:MM]`

**Fallback**（无可用时间戳）：按字节比例切割（seam 处占该 chunk 总字节的比例），不阻断流程，记录 warning。

合并完成后，执行清理：去除所有 `^(\[HH:MM:SS\]) ` 格式的段落行首时间戳，保留章节标题时间戳。

### 6. 断点续跑

- `transcript/chunks/chunk_N.md` 已存在 → 跳过切片（manifest 始终重新生成）
- `writing/chunks/chunk_N_article.md` 已存在且非空 → 跳过该 chunk LLM 调用
- 合并步骤每次重新执行（幂等，覆盖 article.md）

### 7. 错误处理

| 场景 | 行为 |
|------|------|
| 单个 chunk LLM 调用失败 | 整个 article 步骤 failed，保留已生成 chunk articles，可重跑 |
| merge 时某 chunk article 为空 | 跳过该 chunk，记录 warning，继续合并其余 chunk |
| transcript 解析失败（无时间戳） | fallback 到旧单次路径 |
| Python 不可用 | 报错退出，提示安装 Python 3 |

---

## 实现文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `scripts/chunk_transcript.py` | 新建 | 解析时间戳 → 按时间切片 → 生成 manifest.json（单一职责） |
| `scripts/merge_article_chunks.py` | 新建 | 严格 seam 匹配 → 合并 → 去除段落时间戳 |
| `scripts/generate_article.sh` | 修改 | 始终调用 chunk_transcript.py → 从 manifest 读时长 → 分支路径 |

不改动：`llm_engine.sh`、`article_prompt.txt`（单路径用）、`core/`、HTTP API、CLI、GUI

---

## 测试策略

1. **T1 分块正确性**：验证 chunk_transcript.py 对已知视频的切片边界和 manifest 输出
2. **T2 合并正确性**：运行新代码对 `d1553ba60054` 生成 chunk articles，验证 seam 切割点（注：chunk articles 需先由新代码生成）
3. **T3 短视频回归**：< 60 分钟视频仍走旧路径，输出不变
4. **T4 断点续跑**：删除一个 chunk article，重跑 article 步骤，只补跑缺失 chunk
5. **T5 Fallback**：构造无时间戳的 chunk article，验证字节比例切割
6. **T6 seam 算法单元测试**（`scripts/test_merge_seam.py`）：
   - 构造 fixture：两个 chunk article，段落时间戳已知
   - 验证切割点在 seam_time 附近且无重叠
   - 覆盖：正常路径 + fallback（无时间戳近 seam） + 完全无时间戳（字节切割）
7. **T7 strip 时间戳测试**（内嵌于 T6）：
   - 验证 `[HH:MM:SS]` 段落前缀被去除
   - 验证 `## 标题 [HH:MM:SS]` 时间戳被保留

---

## 不在范围内

- summary 步骤（不受影响，继续单次调用）
- 音频下载格式问题（独立 bug）
- Claude 引擎路径（现有逻辑不改）
- chunk 并行处理（顺序即可，long mode 超时 ×3 有足够余量）

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 3 issues fixed, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED — 3 issues found and resolved (D1 seam algorithm bug, D2 dual-mode coupling, D3 missing seam unit tests). Ready to implement.
