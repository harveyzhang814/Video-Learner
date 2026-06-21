#!/usr/bin/env python3
"""
字幕翻译质量量化评估脚本
Usage: python3 tests/eval_translation.py <en.md> <old_zh.md> <new_zh.md>

输出六个维度的量化指标：
  1. 纯净度  — 中文字符占比 / 英文词泄露 / <think> 残留
  2. 覆盖度  — 分段数、总字符数、空段率
  3. 粒度    — 时间戳密度（段/分钟）、平均每段字数
  4. 流畅性  — 中文标点收尾率、平均句长
  5. 一致性  — 高频术语复现率（在两个翻译版本中对比）
  6. 语义覆盖 — 源语言关键词在译文中的对应覆盖
"""
import re, sys, json
from collections import Counter


# ── 解析器 ──────────────────────────────────────────────────────────────────

def parse_vtt_line(content):
    """[HH:MM:SS.mmm --> HH:MM:SS.mmm] text — vtt_converter.py 格式"""
    segs = []
    for line in content.splitlines():
        m = re.match(r'^\[(\d{2}:\d{2}:\d{2})[\d.,]*\s*-->[^\]]*\]\s+(.*)', line.strip())
        if m and m.group(2).strip():
            segs.append((m.group(1), m.group(2).strip()))
    return segs

def parse_heading(content):
    """## HH:MM:SS\\ntext — translate_subs.sh 输出格式"""
    segs = []
    for m in re.finditer(r'^## (\d{1,2}:\d{2}:\d{2})\s*\n(.*?)(?=\n## |\Z)',
                         content, re.MULTILINE | re.DOTALL):
        text = m.group(2).strip()
        if text:
            segs.append((m.group(1), text))
    return segs

def load(path):
    content = open(path, encoding='utf-8').read()
    segs = parse_vtt_line(content)
    if not segs:
        segs = parse_heading(content)
    return segs


# ── 指标函数 ─────────────────────────────────────────────────────────────────

def ts_to_secs(ts):
    parts = ts.split(':')
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    return int(parts[0]) * 60 + float(parts[1])

def cjk_chars(text):
    return sum(1 for c in text if '一' <= c <= '鿿')

def non_space_chars(text):
    return sum(1 for c in text if not c.isspace())

def english_words(text):
    return re.findall(r'[A-Za-z]{3,}', text)

def think_leak(text):
    return bool(re.search(r'<think>', text, re.IGNORECASE))

def zh_punct_ends(text):
    """句子以中文标点结尾的比率（按句子分割）"""
    sents = re.split(r'(?<=[。！？])', text.strip())
    sents = [s.strip() for s in sents if s.strip()]
    if not sents:
        return 0.0
    ended = sum(1 for s in sents if re.search(r'[。！？]$', s))
    return ended / len(sents)

def avg_sent_len(text):
    sents = re.split(r'[。！？]', text)
    sents = [s.strip() for s in sents if s.strip()]
    if not sents:
        return 0.0
    return sum(len(s) for s in sents) / len(sents)

def sents_per_seg(segs):
    """每段包含的完整句子数（中文标点计数）"""
    counts = [len(re.findall(r'[。！？]', t)) for _, t in segs]
    return counts

def fragment_rate(segs, min_chars=20):
    """< min_chars 字符的"碎片段"占比"""
    frags = sum(1 for _, t in segs if len(t) < min_chars)
    return frags / len(segs) if segs else 0.0

def continuation_start_rate(segs):
    """以句子延续词开头的段落占比（表示上文被截断）"""
    # 逗号、顿号开头 → 明确是上文延续
    # 的/了/地/着/而/但/和/或 开头 → 可能是续接
    cont_pattern = re.compile(r'^[，、。；：！？\s]|^[的了地着而但和或以及不也]')
    hits = sum(1 for _, t in segs if cont_pattern.match(t))
    return hits / len(segs) if segs else 0.0

def duration_minutes(segs):
    if len(segs) < 2:
        return None
    return (ts_to_secs(segs[-1][0]) - ts_to_secs(segs[0][0])) / 60


# ── 高频术语提取 ─────────────────────────────────────────────────────────────

def top_terms(segs, n=15, min_len=2):
    all_text = ' '.join(t for _, t in segs)
    # 中文词：连续 CJK 字符（2+ 字）
    zh_words = re.findall(r'[一-鿿]{%d,}' % min_len, all_text)
    # 英文专有词：2+ 字母（大写开头或全英文序列）
    en_words = re.findall(r'[A-Za-z]{4,}', all_text)
    counter = Counter(zh_words + [w.lower() for w in en_words])
    # 过滤高频停用词
    stopwords = {'这个', '我们', '一个', '可以', '那么', '因此', '然而', '以及',
                 '这种', '它的', '进行', '使用', '这些', '如果', '就是',
                 'that', 'this', 'with', 'have', 'from', 'they', 'will',
                 'agent', 'and', 'the', 'for', 'are', 'can', 'our'}
    return [(w, c) for w, c in counter.most_common(n * 3)
            if w not in stopwords][:n]


# ── 源语言关键词覆盖 ──────────────────────────────────────────────────────────

EN_ZH_MAP = {
    'agent': ['代理', '智能体'],
    'coordinator': ['协调'],
    'sequential': ['顺序'],
    'parallel': ['并行'],
    'loop': ['循环'],
    'critique': ['批评', '批判', '审查'],
    'hierarchical': ['层级', '层次', '分层'],
    'workflow': ['工作流'],
    'iteration': ['迭代'],
    'routing': ['路由'],
    'decomposition': ['分解'],
}

def keyword_coverage(en_segs, zh_segs):
    en_text = ' '.join(t for _, t in en_segs).lower()
    zh_text = ' '.join(t for _, t in zh_segs)
    results = {}
    for en_kw, zh_alts in EN_ZH_MAP.items():
        en_count = len(re.findall(r'\b' + en_kw, en_text))
        if en_count == 0:
            continue
        zh_count = sum(zh_text.count(alt) for alt in zh_alts)
        results[en_kw] = {
            'en_count': en_count,
            'zh_count': zh_count,
            'zh_alts': zh_alts,
            'coverage': min(1.0, zh_count / en_count) if en_count else 0.0,
        }
    return results


# ── 聚合评估 ─────────────────────────────────────────────────────────────────

def evaluate(segs, label):
    all_text = ' '.join(t for _, t in segs)
    chunk_lens = [len(t) for _, t in segs]
    total_nonspace = non_space_chars(all_text)
    cjk = cjk_chars(all_text)
    en_words_list = english_words(all_text)
    dur = duration_minutes(segs)

    return {
        'label': label,
        # 1. 纯净度
        'cjk_ratio': round(cjk / total_nonspace, 4) if total_nonspace else 0,
        'english_word_leak': len(en_words_list),
        'think_leak': any(think_leak(t) for _, t in segs),
        # 2. 覆盖度
        'seg_count': len(segs),
        'total_chars': total_nonspace,
        'empty_segs': sum(1 for l in chunk_lens if l == 0),
        # 3. 粒度
        'segs_per_min': round(len(segs) / dur, 2) if dur else None,
        'avg_seg_chars': round(sum(chunk_lens) / len(chunk_lens), 1) if chunk_lens else 0,
        'std_seg_chars': round(
            (sum((l - sum(chunk_lens)/len(chunk_lens))**2 for l in chunk_lens) / len(chunk_lens)) ** 0.5, 1
        ) if chunk_lens else 0,
        # 4. 流畅性
        'zh_punct_end_rate': round(zh_punct_ends(all_text), 4),
        'avg_sent_len_chars': round(avg_sent_len(all_text), 1),
        # 5. 片段完整性
        'fragment_rate': round(fragment_rate(segs), 4),
        'continuation_start_rate': round(continuation_start_rate(segs), 4),
        'avg_sents_per_seg': round(
            sum(sents_per_seg(segs)) / len(segs) if segs else 0, 2),
        'zero_sent_segs': sum(1 for c in sents_per_seg(segs) if c == 0),
        # 6. 高频术语
        'top_terms': top_terms(segs),
    }


# ── 主函数 ───────────────────────────────────────────────────────────────────

def fmt_bar(val, max_val, width=20, fill='█', empty='░'):
    filled = int(round(val / max_val * width)) if max_val else 0
    return fill * filled + empty * (width - filled)

def main():
    if len(sys.argv) < 4:
        print("Usage: python3 eval_translation.py <en.md> <old_zh.md> <new_zh.md>")
        sys.exit(1)

    en_path, old_path, new_path = sys.argv[1], sys.argv[2], sys.argv[3]
    en_segs  = load(en_path)
    old_segs = load(old_path)
    new_segs = load(new_path)

    old = evaluate(old_segs, '旧方案（逐行）')
    new = evaluate(new_segs, '新方案（分块）')
    kw  = keyword_coverage(en_segs, old_segs)
    kw2 = keyword_coverage(en_segs, new_segs)

    print('=' * 70)
    print('  字幕翻译质量评估报告')
    print('  源文件:', en_path.split('/')[-1])
    print('  旧方案:', old_path.split('/')[-1])
    print('  新方案:', new_path.split('/')[-1])
    print('=' * 70)

    # ── 1. 纯净度 ──────────────────────────────────────────────────────────
    print('\n[1] 纯净度 (Purity)')
    print(f"  {'指标':<25} {'旧方案':>10} {'新方案':>10}")
    print(f"  {'-'*47}")
    print(f"  {'中文字符占比':<25} {old['cjk_ratio']:>10.1%} {new['cjk_ratio']:>10.1%}")
    print(f"  {'英文词泄露数':<25} {old['english_word_leak']:>10} {new['english_word_leak']:>10}")
    print(f"  {'<think> 块残留':<24} {'是' if old['think_leak'] else '否':>10} {'是' if new['think_leak'] else '否':>10}")

    # ── 2. 覆盖度 ──────────────────────────────────────────────────────────
    print('\n[2] 覆盖度 (Coverage)')
    print(f"  {'指标':<25} {'旧方案':>10} {'新方案':>10} {'源文件':>10}")
    print(f"  {'-'*57}")
    print(f"  {'分段数':<25} {old['seg_count']:>10} {new['seg_count']:>10} {len(en_segs):>10}")
    print(f"  {'总非空字符数':<25} {old['total_chars']:>10} {new['total_chars']:>10}")
    print(f"  {'空段数':<25} {old['empty_segs']:>10} {new['empty_segs']:>10}")

    # ── 3. 粒度 ────────────────────────────────────────────────────────────
    print('\n[3] 粒度 (Granularity)')
    print(f"  {'指标':<25} {'旧方案':>10} {'新方案':>10}")
    print(f"  {'-'*47}")
    old_spm = f"{old['segs_per_min']}" if old['segs_per_min'] else 'N/A'
    new_spm = f"{new['segs_per_min']}" if new['segs_per_min'] else 'N/A'
    print(f"  {'时间戳密度（段/分钟）':<23} {old_spm:>10} {new_spm:>10}")
    print(f"  {'平均每段字符数':<24} {old['avg_seg_chars']:>10} {new['avg_seg_chars']:>10}")
    print(f"  {'每段字符数标准差':<23} {old['std_seg_chars']:>10} {new['std_seg_chars']:>10}")

    # ── 4. 流畅性 ──────────────────────────────────────────────────────────
    print('\n[4] 流畅性代理指标 (Fluency Proxy)')
    print(f"  {'指标':<25} {'旧方案':>10} {'新方案':>10}")
    print(f"  {'-'*47}")
    print(f"  {'中文标点收尾率':<24} {old['zh_punct_end_rate']:>10.1%} {new['zh_punct_end_rate']:>10.1%}")
    print(f"  {'平均句子长度（字符）':<23} {old['avg_sent_len_chars']:>10} {new['avg_sent_len_chars']:>10}")

    # ── 5. 片段完整性 ─────────────────────────────────────────────────────
    print('\n[5] 片段完整性 (Segment Completeness)  ← 核心差异')
    print(f"  {'指标':<30} {'旧方案':>10} {'新方案':>10}  说明")
    print(f"  {'-'*72}")
    print(f"  {'碎片率（<20字的段）':<29} {old['fragment_rate']:>10.1%} {new['fragment_rate']:>10.1%}  越低越好")
    print(f"  {'续接开头率（被截断的段）':<27} {old['continuation_start_rate']:>10.1%} {new['continuation_start_rate']:>10.1%}  越低越好")
    print(f"  {'平均每段完整句子数':<29} {old['avg_sents_per_seg']:>10.2f} {new['avg_sents_per_seg']:>10.2f}  越高越好")
    print(f"  {'无完整句子的段数':<30} {old['zero_sent_segs']:>10} {new['zero_sent_segs']:>10}  越低越好")

    # ── 6. 关键词覆盖 ──────────────────────────────────────────────────────
    print('\n[5] 源语言关键词覆盖率 (Keyword Coverage)')
    print(f"  {'关键词':<15} {'源文出现':>8} {'旧方案译文':>10} {'新方案译文':>10} {'旧覆盖':>8} {'新覆盖':>8}")
    print(f"  {'-'*65}")
    all_kws = set(kw.keys()) | set(kw2.keys())
    for k in sorted(all_kws):
        o = kw.get(k, {'en_count': 0, 'zh_count': 0, 'coverage': 0.0})
        n = kw2.get(k, {'en_count': 0, 'zh_count': 0, 'coverage': 0.0})
        en_n = o.get('en_count', 0) or n.get('en_count', 0)
        print(f"  {k:<15} {en_n:>8} {o['zh_count']:>10} {n['zh_count']:>10} "
              f"{o['coverage']:>8.0%} {n['coverage']:>8.0%}")

    # 加权平均
    old_avg = sum(kw[k]['coverage'] for k in kw) / len(kw) if kw else 0
    new_avg = sum(kw2[k]['coverage'] for k in kw2) / len(kw2) if kw2 else 0
    print(f"  {'加权平均':<15} {'':>8} {'':>10} {'':>10} {old_avg:>8.0%} {new_avg:>8.0%}")

    # ── 6. 高频术语对比 ────────────────────────────────────────────────────
    print('\n[6] 高频术语 Top-10')
    old_terms = dict(old['top_terms'][:10])
    new_terms = dict(new['top_terms'][:10])
    all_terms = sorted(set(old_terms) | set(new_terms),
                       key=lambda t: -(old_terms.get(t, 0) + new_terms.get(t, 0)))[:10]
    print(f"  {'术语':<15} {'旧方案':>8} {'新方案':>8}")
    print(f"  {'-'*35}")
    for t in all_terms:
        print(f"  {t:<15} {old_terms.get(t, 0):>8} {new_terms.get(t, 0):>8}")

    # ── 综合评分 ───────────────────────────────────────────────────────────
    print('\n' + '=' * 70)
    print('  综合评分（越高越好，满分 100）')
    print('=' * 70)

    def score(m, kw_cov):
        # 权重设计：片段完整性(30) + 纯净度(25) + 语义覆盖(20) + 流畅性(15) + 覆盖量(10)
        s = 0
        # 片段完整性（共30分）
        s += (1 - m['fragment_rate']) * 10          # 碎片率
        s += (1 - m['continuation_start_rate']) * 10  # 截断续接率
        s += min(1.0, m['avg_sents_per_seg'] / 3) * 10  # 每段句子数（满3句得满分）
        # 纯净度（共25分）
        s += m['cjk_ratio'] * 15
        s += max(0, 1 - m['english_word_leak'] / 30) * 5
        s += (0 if m['think_leak'] else 1) * 5
        # 语义覆盖（20分）
        s += kw_cov * 20
        # 流畅性（15分）
        s += m['zh_punct_end_rate'] * 15
        # 内容量（10分）
        s += min(1.0, m['total_chars'] / 3000) * 10
        return round(s, 1)

    old_score = score(old, old_avg)
    new_score = score(new, new_avg)

    bar_old = fmt_bar(old_score, 100)
    bar_new = fmt_bar(new_score, 100)
    print(f"  旧方案: {old_score:5.1f}/100  {bar_old}")
    print(f"  新方案: {new_score:5.1f}/100  {bar_new}")
    print(f"  提升幅度: +{new_score - old_score:.1f} 分")
    print()

if __name__ == '__main__':
    main()
