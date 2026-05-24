# Summary 章节感知分段设计文档

**日期**：2026-05-24  
**分支**：feature/long-video-timeout  
**问题**：summary_prompt.txt 硬编码 300-500 字限制；长视频 article 超出 MiniMax 单次输入容量时无法生成完整 summary

---

## 背景

- 当前 `generate_summary.sh` 将完整 article 一次性喂给 LLM，且 prompt 限制输出 300-500 字
- 3h47m 视频的 article 约 68,000 字符、~75,500 MiniMax tokens，单次仍在 204,800 token context 内
- 但 6h+ 视频的 article 可能超出 MiniMax 安全输入上限（~100,000 字符）
- 字数限制对所有视频都是不必要的质量损失

---

## 目标

- 所有视频：去掉 summary 字数限制，让 LLM 自由输出
- 长 article（章节 ≥ 3 trunks）：Map-Reduce 章节感知分段，保证连贯性
- 短 article（章节 < 3 trunks）：单次调用，不增加复杂度
- 复用 article 步骤的架构模式（standalone Python scripts，无 heredoc 编码问题）

---

## 方案：章节感知 Map-Reduce

### 1. 触发条件

`generate_summary.sh` 调用 `split_article_sections.py` 解析章节，根据分组结果决定路径：

```
trunks = split_article_sections(article.md)

if len(trunks) <= 2:
    → 单次调用（summary_prompt.txt，无字数限制）
else:
    → Map-Reduce（mini prompt × N → reduce prompt → summary.md）
```

### 2. 章节切分与分组

`split_article_sections.py` 单一职责：解析 `## ` 开头的章节标题，合并成 trunks。

**分组公式**：
```python
target = min(6, math.ceil(section_count / 20))
trunk_size = math.ceil(section_count / target)
```

| section 数 | target trunks | 路径 |
|-----------|--------------|------|
| 0–1（无标题或 1 节） | 1 | 单次 |
| 2–40 | 1–2 | 单次 |
| 41–60 | 3 | Map-Reduce |
| 61–120 | 4–6 | Map-Reduce |
| 121–147（实测 3h47m） | 6 | Map-Reduce |

**Fallback**（无 `##` 章节标题）：整篇 article 视为 1 trunk → 单次调用。

输出：`writing/chunks/sections_manifest.json`

```json
{
  "section_count": 147,
  "trunk_count": 6,
  "trunks": [
    {
      "index": 1,
      "start_line": 1,
      "end_line": 310,
      "section_count": 25,
      "first_heading": "## 开场与嘉宾介绍 [00:00:00]",
      "last_heading": "## 研究效率的提升"
    }
  ]
}
```

### 3. Map 阶段（mini-summary）

每个 trunk → `build_section_prompt.py` 构建 prompt → `llm_engine.sh` → `trunk_N_summary.md`

- **字数限制**：无（让模型决定合适篇幅）
- **Prompt**：`summary_mini_prompt.txt`，说明这是完整 article 的第 N/total 段
- **断点续跑**：`writing/chunks/trunk_N_summary.md` 存在且非空 → 跳过

### 4. Reduce 阶段（final summary）

所有 `trunk_N_summary.md` 拼接 → `build_reduce_prompt.py` 构建 prompt → `llm_engine.sh` → `summary.md`

- **字数限制**：无
- **Prompt**：`summary_reduce_prompt.txt`，基于各段摘要综合生成最终 summary
- 每次重新执行（幂等，覆盖 summary.md）

### 5. 单次路径改动

仅修改 `summary_prompt.txt`：删除 "约 300-500 字" 和 "简洁" 约束，保留其他结构要求。

---

## 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `scripts/split_article_sections.py` | 新建 | 解析章节 → 分组 → manifest.json |
| `scripts/build_section_prompt.py` | 新建 | 构建 trunk mini-summary prompt |
| `scripts/build_reduce_prompt.py` | 新建 | 构建 reduce 阶段 prompt |
| `scripts/summary_mini_prompt.txt` | 新建 | Mini-summary 指令（无字数限制）|
| `scripts/summary_reduce_prompt.txt` | 新建 | Reduce 综合指令（无字数限制）|
| `scripts/summary_prompt.txt` | 修改 | 删除字数限制和"简洁"措辞 |
| `scripts/generate_summary.sh` | 修改 | 加入章节感知路径，修复 heredoc 编码 bug |

不改动：`llm_engine.sh`、`chunk_transcript.py`、`merge_article_chunks.py`、core/、HTTP API、GUI

---

## 错误处理

| 场景 | 行为 |
|------|------|
| 单个 trunk LLM 调用失败 | 整个 summary 步骤 failed，保留已生成 trunk summaries，可重跑 |
| article 无章节标题 | 走单次路径，记录 info 日志 |
| split 脚本失败 | fallback 单次路径，记录 warning |

---

## 实测验证（3h47m 视频）

- Article：175KB，68,000 字符，147 个章节
- 分组：6 trunks × 25 节，每 trunk 约 37 分钟内容
- 每 trunk 输入：~25 节 × 12 行 = 300 行，约 11,000 字符，远在 MiniMax 上限内
- Reduce 输入：6 个 trunk summaries，预计 3,000–8,000 字符，轻松处理
