#!/bin/bash
# report.sh — Generate comparison report.md from three metrics.json files

set -euo pipefail

TASK_ID=""
DIR_A="" DIR_B="" DIR_C=""
OUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id) TASK_ID="$2"; shift 2 ;;
    --dir-a)   DIR_A="$2";   shift 2 ;;
    --dir-b)   DIR_B="$2";   shift 2 ;;
    --dir-c)   DIR_C="$2";   shift 2 ;;
    --out)     OUT_FILE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

for d in "$DIR_A" "$DIR_B" "$DIR_C"; do
  [[ -f "$d/metrics.json" ]] || { echo "Missing metrics.json in: $d" >&2; exit 1; }
done
[[ -n "$OUT_FILE" ]] || { echo "Missing --out" >&2; exit 1; }

python3 - "$TASK_ID" "$DIR_A/metrics.json" "$DIR_B/metrics.json" "$DIR_C/metrics.json" "$OUT_FILE" << 'PYEOF'
import json, sys

task_id = sys.argv[1]
files = {"A": sys.argv[2], "B": sys.argv[3], "C": sys.argv[4]}
out_path = sys.argv[5]

data = {k: json.load(open(v)) for k, v in files.items()}

def cache_input(m):
    # cache.write = tokens sent this call; cache.read = reused from prior calls
    c = m.get("cache", {})
    return c.get("write", 0) + c.get("read", 0)

def fmt_ms(ms):
    return f"{ms/1000:.1f}s"

lines = [
    f"# Session Chain 实验报告 — task: {task_id}",
    "",
    "## Token 消耗对比",
    "",
    "| 方案 | article input¹ | article output | article cache.read | summary input¹ | summary output | summary cache.read | 合计 tokens |",
    "|------|---------------|---------------|-------------------|---------------|---------------|-------------------|------------|",
]

total_row = {}
for k, d in data.items():
    a = d["article"]
    s = d["summary"]
    a_in  = cache_input(a)
    a_out = a.get("output", 0)
    a_cr  = a.get("cache", {}).get("read", 0)
    s_in  = cache_input(s)
    s_out = s.get("output", 0)
    s_cr  = s.get("cache", {}).get("read", 0)
    total = a.get("total", 0) + s.get("total", 0)
    label = {"A": "A (纯上下文)", "B": "B (混合)", "C": "C (基线)"}[k]
    lines.append(f"| {label} | {a_in:,} | {a_out:,} | {a_cr:,} | {s_in:,} | {s_out:,} | {s_cr:,} | {total:,} |")

lines += [
    "",
    "¹ input = cache.write + cache.read（opencode/MiniMax 把实际 input 拆入 cache 字段，raw input 字段为 0）",
    "",
    "## 耗时对比",
    "",
    "| 方案 | article 耗时 | summary 耗时 | 总耗时 |",
    "|------|------------|-------------|------|",
]

for k, d in data.items():
    label = {"A": "A (纯上下文)", "B": "B (混合)", "C": "C (基线)"}[k]
    a_t = d["article"]["time_ms"]
    s_t = d["summary"]["time_ms"]
    tot = d["total_time_ms"]
    lines.append(f"| {label} | {fmt_ms(a_t)} | {fmt_ms(s_t)} | {fmt_ms(tot)} |")

lines += [
    "",
    "## 输出文件",
    "",
    "| 方案 | article | summary |",
    "|------|---------|---------|",
    f"| A (纯上下文) | [article.md](approach_a/article.md) | [summary.md](approach_a/summary.md) |",
    f"| B (混合)     | [article.md](approach_b/article.md) | [summary.md](approach_b/summary.md) |",
    f"| C (基线)     | [article.md](approach_c/article.md) | [summary.md](approach_c/summary.md) |",
    "",
    "## 质量评估（人工）",
    "",
    "请对比各方案 summary.md 与生产基准（`work/" + task_id + "/writing/summary.md`）：",
    "- 信息覆盖度：关键论点是否遗漏",
    "- 术语一致性：与对应 article.md 的用词是否一致",
    "- 方案 A 特别关注：summary 是否有无中生有的内容（模型记忆偏差）",
]

open(out_path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"Report written to {out_path}")
PYEOF
