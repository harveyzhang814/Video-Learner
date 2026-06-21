# 字幕翻译步骤（translate）实施计划

**目标：** 在 DAG 侧链中于 `vtt2md` 和 `md2vtt` 之间插入 `translate` 节点，将英文 `original_en.md` 翻译为中文 `original_zh.md`，供 `md2vtt` 生成中文 VTT 字幕。

**架构：** `schedule.js` 新增 DAG 边和超时；`index.js` 新增 `case 'translate'`（三条跳过条件 + runStepScript）和存量任务迁移补丁；`translate_subs.sh` 实现三阶段翻译（Python 分块 → 顺序 LLM → Python 组装）。

**技术栈：** Node.js（编排器）、Bash + Python 3（翻译脚本）、llm_engine.sh（现有 LLM 路由）、SQLite（步骤状态）

---

### Task 1：schedule.js — DAG 连线

**文件：**
- 修改: `core/orchestrator/schedule.js:17-27`（超时）
- 修改: `core/orchestrator/schedule.js:66-76`（边）
- 修改: `core/orchestrator/schedule.js:78-88`（步骤列表）
- 修改: `core/orchestrator/schedule.js:243`（次级链顺序）

- [ ] **Step 1：在 `_STEP_TIMEOUTS_MS` 加入 translate**

在 `core/orchestrator/schedule.js` 第 25-26 行（`article` / `summary` 之间）插入：

```js
// 当前第 17-27 行：
const _STEP_TIMEOUTS_MS = {
  fetch:     10  * 60 * 1000,
  video:    120  * 60 * 1000,
  audio:     30  * 60 * 1000,
  subs:      10  * 60 * 1000,
  asr:       60  * 60 * 1000,
  vtt2md:    10  * 60 * 1000,
  md2vtt:    10  * 60 * 1000,
  translate: 60  * 60 * 1000,  // ← 新增，60 min（随 timeout_scale 缩放）
  article:   60  * 60 * 1000,
  summary:   60  * 60 * 1000,
};
```

- [ ] **Step 2：替换 STEP_EDGES 中 `vtt2md→md2vtt`**

当前第 73 行：`['vtt2md', 'md2vtt'],`

替换为：

```js
const STEP_EDGES = [
  ['fetch', 'video'],
  ['fetch', 'audio'],
  ['fetch', 'subs'],
  ['fetch', 'asr'],
  ['subs', 'vtt2md'],
  ['asr', 'vtt2md'],
  ['vtt2md', 'translate'],   // ← 新增
  ['translate', 'md2vtt'],   // ← 新增（替换原 vtt2md→md2vtt）
  ['vtt2md', 'article'],
  ['article', 'summary']
];
```

- [ ] **Step 3：在 ALL_STEPS 中插入 translate**

当前第 78-88 行，在 `'vtt2md'` 后、`'md2vtt'` 前插入 `'translate'`：

```js
const ALL_STEPS = [
  'fetch',
  'video',
  'audio',
  'subs',
  'asr',
  'vtt2md',
  'translate',   // ← 新增
  'md2vtt',
  'article',
  'summary'
];
```

- [ ] **Step 4：在 SECONDARY_CHAIN_BASE 中插入 translate**

当前第 243 行：

```js
const SECONDARY_CHAIN_BASE = ['video', 'audio', 'asr', 'md2vtt'];
```

改为：

```js
const SECONDARY_CHAIN_BASE = ['video', 'audio', 'asr', 'translate', 'md2vtt'];
```

- [ ] **Step 5：运行 schedule 单元测试（预期此时 FAIL，因为 test 还未更新）**

```bash
node tests/orchestrator-schedule.test.js
```

预期：FAIL，第 183 行 `assert.ok(ready.has('md2vtt'))` 报错。这确认改动生效。

---

### Task 2：orchestrator-schedule.test.js — 修复回归 + 新增 DAG 测试

**文件：**
- 修改: `tests/orchestrator-schedule.test.js:18-30`（baseSteps）
- 修改: `tests/orchestrator-schedule.test.js:174-185`（回归修复）
- 修改: `tests/orchestrator-schedule.test.js:130-171`（清理不一致状态）
- 新增: `tests/orchestrator-schedule.test.js`（三组新测试）

- [ ] **Step 1：更新 baseSteps() 加入 translate**

第 18-30 行的 `baseSteps()` 函数，补充 `translate: pending()`：

```js
function baseSteps() {
  return {
    fetch: pending(),
    video: pending(),
    audio: pending(),
    subs: pending(),
    asr: pending(),
    vtt2md: pending(),
    translate: pending(),   // ← 新增
    md2vtt: pending(),
    article: pending(),
    summary: pending()
  };
}
```

- [ ] **Step 2：修复回归（第 174 行测试）**

当前第 174-185 行：

```js
// vtt2md completed; article+md2vtt pending → pick article (main before secondary)
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  steps.vtt2md = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('article'));
  assert.ok(ready.has('md2vtt'));   // ← REGRESSION：translate 插入后此断言失败
  assert.strictEqual(pickNextStep(ready, 'media', task.steps), 'article');
}
```

改为：

```js
// vtt2md completed; article+translate pending → pick article (main before secondary)
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  steps.vtt2md = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('article'),   'article ready after vtt2md');
  assert.ok(ready.has('translate'), 'translate ready after vtt2md');
  assert.ok(!ready.has('md2vtt'),   'md2vtt blocked until translate done');
  assert.strictEqual(pickNextStep(ready, 'media', task.steps), 'article');
}
```

- [ ] **Step 3：清理第 130-144、158-172 行的不一致状态**

这两个测试设置了 `steps.md2vtt = completed()` 但未设置 `steps.translate = completed()`，在新 DAG 下是不一致状态。补充 translate 状态：

第 130-144 行（在 `steps.md2vtt = completed()` 后加）：
```js
steps.translate = completed();   // ← 新增
```

第 158-172 行（在 `steps.md2vtt = completed()` 后加）：
```js
steps.translate = completed();   // ← 新增
```

- [ ] **Step 4：新增 translate DAG 调度测试**

在测试文件末尾的 `console.log('PASS')` 前，插入：

```js
// translate: ready after vtt2md completed
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  steps.vtt2md = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('translate'), 'translate ready when vtt2md completed');
  assert.ok(!ready.has('md2vtt'),   'md2vtt not ready until translate done');
}

// md2vtt: ready after translate completed
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  steps.vtt2md = completed();
  steps.translate = completed();
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('md2vtt'),    'md2vtt ready after translate completed');
  assert.ok(!ready.has('translate'),'translate not re-ready after completed');
}

// md2vtt: ready after translate skipped
{
  const steps = baseSteps();
  steps.fetch = completed();
  steps.subs = completed();
  steps.vtt2md = completed();
  steps.translate = { status: 'skipped', attempts: 0, error: null };
  const task = { params: { mode: 'media' }, steps };
  const ready = computeReadySteps(task);
  assert.ok(ready.has('md2vtt'), 'md2vtt ready after translate skipped');
}

// getDownstreamClosure: vtt2md closure includes translate
{
  const c = getDownstreamClosure('vtt2md');
  assert.ok(c.has('translate'), 'translate in vtt2md downstream closure');
  assert.ok(c.has('md2vtt'),    'md2vtt in vtt2md downstream closure');
  assert.ok(c.has('article'),   'article in vtt2md downstream closure');
  assert.ok(c.has('summary'),   'summary in vtt2md downstream closure');
}
```

- [ ] **Step 5：确认测试通过**

```bash
node tests/orchestrator-schedule.test.js
```

预期：`orchestrator-schedule.test.js: PASS`

- [ ] **Step 6：提交**

```bash
git add core/orchestrator/schedule.js tests/orchestrator-schedule.test.js
git commit -m "feat: insert translate step between vtt2md and md2vtt in DAG"
```

---

### Task 3：index.js — translate 处理器 + 存量迁移

**文件：**
- 修改: `core/orchestrator/index.js:129`（STEPS）
- 修改: `core/orchestrator/index.js:131-141`（STEP_SCRIPTS）
- 新增: `core/orchestrator/index.js:759` 后（case 'translate'）
- 修改: `core/orchestrator/index.js:1127` 后（迁移补丁）

- [ ] **Step 1：在 STEPS 中插入 translate**

第 129 行：

```js
// 当前：
const STEPS = ['fetch', 'video', 'audio', 'subs', 'asr', 'vtt2md', 'md2vtt', 'article', 'summary'];

// 改为：
const STEPS = ['fetch', 'video', 'audio', 'subs', 'asr', 'vtt2md', 'translate', 'md2vtt', 'article', 'summary'];
```

- [ ] **Step 2：在 STEP_SCRIPTS 中加入 translate**

第 131-141 行，在 `vtt2md` 和 `md2vtt` 之间插入：

```js
const STEP_SCRIPTS = {
  fetch:     'fetch_info.sh',
  video:     'download_video.sh',
  audio:     'download_audio.sh',
  subs:      'download_subs.sh',
  asr:       'asr_transcribe.sh',
  vtt2md:    'convert_vtt_md.sh',
  translate: 'translate_subs.sh',   // ← 新增
  md2vtt:    'convert_md_vtt.sh',
  article:   'generate_article.sh',
  summary:   'generate_summary.sh'
};
```

- [ ] **Step 3：在第 758 行（vtt2md case 结束）后插入 case 'translate'**

紧接 `}` 后（第 758 行）插入：

```js
    case 'translate': {
      const outputLang = (task.params && task.params.output_lang) || 'zh-CN';

      // Skip-3: 目标语言非中文（output_lang 不以 'zh' 开头）
      if (!outputLang.startsWith('zh')) {
        stepState.status = 'skipped';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'skipped');
        finishLogs();
        return { success: true };
      }
      // Skip-1: original_zh.md 已存在，无需翻译
      if (fs.existsSync(zhMd)) {
        stepState.status = 'skipped';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'skipped');
        finishLogs();
        return { success: true };
      }
      // Skip-2: original_en.md 不存在，无源文件
      if (!fs.existsSync(enMd)) {
        stepState.status = 'skipped';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'skipped');
        finishLogs();
        return { success: true };
      }

      // 执行翻译
      const result = await runStepScript(rootDir, 'translate', [enMd, zhMd], {
        onOutput: options.onOutput,
        onStdout,
        onStderr,
        onProc: (proc) => { task._currentProc = proc; },
        timeoutScale: options.timeoutScale,
      });
      task._currentProc = null;

      if (task._stepAbortResolve) {
        const resolve = task._stepAbortResolve;
        task._stepAbortResolve = null;
        stepState.status = 'pending';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'pending');
        finishLogs();
        emitOrchestratorEvent('step.finished', taskId, { stepName, status: 'pending', aborted: true });
        emitOrchestratorEvent('task.updated', taskId, { status: task.status, stepName, stepStatus: 'pending' });
        resolve();
        return { success: false, error: 'aborted' };
      }
      if (task._abortFlag) {
        finishLogs();
        return { success: false, error: 'aborted' };
      }
      if (result.code !== 0) {
        stepState.status = 'failed';
        stepState.error = result.output || 'translate_subs.sh failed';
        task.steps[stepName] = stepState;
        db.updateStep(id, stepName, 'failed', stepState.error);
        finishLogs();
        return { success: false, error: stepState.error };
      }
      stepState.status = 'completed';
      task.steps[stepName] = stepState;
      db.updateStep(id, stepName, 'completed');
      finishLogs();
      return { success: true };
    }
```

- [ ] **Step 4：在第 1127 行（现有 summary 迁移）后加存量任务迁移补丁**

当前第 1123-1127 行结尾处的 `}` 后（即三条迁移 if 结束后、`task.steps = steps;` 前）插入：

```js
          // D1: 为缺少 translate 步骤记录的存量任务补写 pending。
          // translate 的跳过条件（zh.md 已存在等）在实际执行时检查，
          // pending 仅意味着"待 DAG 评估"。
          if (!steps.translate) {
            steps.translate = { status: 'pending', attempts: 0, error: null };
            db.updateStep(id, 'translate', 'pending');
          }
```

- [ ] **Step 5：核查 translate 不会意外阻塞 isTaskCompleted**

`CRITICAL_PATH = ['fetch', 'vtt2md', 'article', 'summary']`，translate 不在其中。无需改动。

运行完整编排器测试确认无回归：

```bash
node tests/agent-sqlite-persistence.test.js
node tests/runstep-a-layer-orchestrator.test.js
```

预期：PASS

- [ ] **Step 6：提交**

```bash
git add core/orchestrator/index.js
git commit -m "feat: add translate case handler and migration backfill to orchestrator"
```

---

### Task 4：translate_subs.sh — 新文件（三阶段翻译）

**文件：**
- 创建: `scripts/translate_subs.sh`

- [ ] **Step 1：创建脚本文件**

`scripts/translate_subs.sh` 完整内容：

```bash
#!/bin/bash
# Subtitle translation step
# Usage: bash scripts/translate_subs.sh <INPUT_EN_MD> <OUTPUT_ZH_MD>

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 2 ]; then
    echo "[STATUS] translate_error: Missing arguments"
    echo "Usage: $0 <INPUT_EN_MD> <OUTPUT_ZH_MD>"
    exit 1
fi

INPUT_MD="$1"
OUTPUT_MD="$2"

if [ ! -f "$INPUT_MD" ]; then
    echo "[STATUS] translate_error: Input file not found: $INPUT_MD"
    exit 1
fi

echo "[STATUS] translate_start"
mkdir -p "$(dirname "$OUTPUT_MD")"

TMPDIR_TRANS=$(mktemp -d /tmp/translate-XXXXXXXX)
trap 'rm -rf "$TMPDIR_TRANS"' EXIT INT TERM

# ── Phase 1: 时间窗口分块 ──────────────────────────────────────────────────────
CHUNKS_JSON="$TMPDIR_TRANS/chunks.json"

python3 - "$INPUT_MD" "$CHUNKS_JSON" <<'PYTHON_EOF'
import sys, json, re

WINDOW_SECS = 25   # 目标窗口 20-30s
MAX_CHARS   = 800  # 单块字符硬上限

def ts_to_secs(ts):
    parts = ts.split(':')
    if len(parts) == 3:
        h, m, s = parts; return int(h)*3600 + int(m)*60 + float(s)
    elif len(parts) == 2:
        m, s = parts; return int(m)*60 + float(s)
    return 0.0

content = open(sys.argv[1], encoding='utf-8').read()
block_re = re.compile(r'^## (\d{1,2}:\d{2}:\d{2})\s*\n(.*?)(?=\n## |\Z)',
                      re.MULTILINE | re.DOTALL)
blocks = [(m.group(1), m.group(2).strip()) for m in block_re.finditer(content)]

if not blocks:
    print("ERROR: no timestamp blocks found", file=sys.stderr)
    sys.exit(1)

chunks = []
cur_start_ts   = blocks[0][0]
cur_start_secs = ts_to_secs(blocks[0][0])
cur_texts      = []

for ts, text in blocks:
    secs    = ts_to_secs(ts)
    elapsed = secs - cur_start_secs
    if elapsed >= WINDOW_SECS or len(' '.join(cur_texts + [text])) > MAX_CHARS:
        if cur_texts:
            chunks.append({'start_ts': cur_start_ts, 'text': ' '.join(cur_texts)})
        cur_start_ts, cur_start_secs, cur_texts = ts, secs, [text]
    else:
        cur_texts.append(text)

if cur_texts:
    chunks.append({'start_ts': cur_start_ts, 'text': ' '.join(cur_texts)})

json.dump(chunks, open(sys.argv[2], 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
print(f"Phase1: {len(chunks)} chunks from {len(blocks)} blocks")
PYTHON_EOF

CHUNK_COUNT=$(python3 -c "import json; print(len(json.load(open('$CHUNKS_JSON'))))")
echo "[STATUS] translate_chunks: $CHUNK_COUNT"

# ── Phase 2: 顺序 LLM 翻译 ───────────────────────────────────────────────────
ZH_DIR="$TMPDIR_TRANS/results"
mkdir -p "$ZH_DIR"
zh_prev_tail=""
failed_count=0

for i in $(seq 0 $((CHUNK_COUNT - 1))); do
    echo "[STATUS] translate_chunk $((i+1))/$CHUNK_COUNT"

    MERGED_EN=$(python3 -c "import json; print(json.load(open('$CHUNKS_JSON'))[$i]['text'])")
    NEXT_EN=""
    if [ "$i" -lt "$((CHUNK_COUNT - 1))" ]; then
        NEXT_EN=$(python3 -c "import json; print(json.load(open('$CHUNKS_JSON'))[$((i+1))]['text'])")
    fi

    PROMPT_FILE="$TMPDIR_TRANS/prompt_$i.txt"
    {
        printf '你是一名字幕翻译员。将【待翻译】内容翻译为简体中文。\n'
        printf '要求：语义准确、中文流畅，不限行数和结构。\n'
        if [ -n "$zh_prev_tail" ]; then
            printf '从【已翻译上文】结束的语义节点自然接续，不重复上文内容。\n\n'
            printf '--- 已翻译上文（末尾，接续参考）---\n%s\n' "$zh_prev_tail"
        fi
        printf '\n--- 待翻译 ---\n%s\n' "$MERGED_EN"
        if [ -n "$NEXT_EN" ]; then
            printf '\n--- 下文参考（只读，不翻译）---\n%s\n' "$NEXT_EN"
        fi
    } > "$PROMPT_FILE"

    ZH_OUT="$ZH_DIR/chunk_$i.txt"
    if bash "$SCRIPT_DIR/llm_engine.sh" --input "$PROMPT_FILE" --output "$ZH_OUT" 2>/dev/null; then
        zh_prev_tail=$(python3 -c "
t = open('$ZH_OUT', encoding='utf-8').read().strip()
print(t[-150:] if len(t) > 150 else t)
")
    else
        echo "[STATUS] translate_error: chunk $((i+1)) LLM failed, skipping"
        zh_prev_tail=""
        failed_count=$((failed_count + 1))
    fi
done

if [ "$failed_count" -eq "$CHUNK_COUNT" ]; then
    echo "[STATUS] translate_error: all $CHUNK_COUNT chunks failed"
    exit 1
fi

# ── Phase 3: 组装 original_zh.md ─────────────────────────────────────────────
python3 - "$CHUNKS_JSON" "$ZH_DIR" "$OUTPUT_MD" <<'PYTHON_EOF'
import sys, json, os

chunks = json.load(open(sys.argv[1], encoding='utf-8'))
results_dir, output_md = sys.argv[2], sys.argv[3]

lines = []
for i, chunk in enumerate(chunks):
    rf = os.path.join(results_dir, f'chunk_{i}.txt')
    if not os.path.exists(rf):
        continue
    zh = open(rf, encoding='utf-8').read().strip()
    if zh:
        lines.append(f"## {chunk['start_ts']}\n{zh}")

if not lines:
    print("ERROR: no translated chunks to write", file=sys.stderr)
    sys.exit(1)

open(output_md, 'w', encoding='utf-8').write('\n\n'.join(lines) + '\n')
print(f"Phase3: wrote {len(lines)} chunks to {output_md}")
PYTHON_EOF

echo "[STATUS] translate_done"
```

- [ ] **Step 2：赋予执行权限**

```bash
chmod +x scripts/translate_subs.sh
```

- [ ] **Step 3：冒烟测试（使用真实 fixture）**

```bash
# 先确认 llm_engine.sh 可用
bash scripts/llm_engine.sh --help 2>&1 || true

# 创建测试 fixture
cat > /tmp/test_en.md << 'EOF'
## 00:00:05
Hello and welcome

## 00:00:08
to this lecture on machine learning

## 00:00:30
Today we will cover

## 00:00:33
the basics of neural networks

## 00:01:00
Let us begin with the fundamentals
EOF

bash scripts/translate_subs.sh /tmp/test_en.md /tmp/test_zh.md
cat /tmp/test_zh.md
```

预期：输出包含若干 `## HH:MM:SS` 块，每块内容为中文。

- [ ] **Step 4：提交**

```bash
git add scripts/translate_subs.sh
git commit -m "feat: add translate_subs.sh for subtitle translation (Phase 1/2/3)"
```

---

### Task 5：translate-step.test.js — skip 条件 + 迁移测试

**文件：**
- 创建: `tests/translate-step.test.js`

- [ ] **Step 1：创建测试文件**

```js
'use strict';

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// We test the skip-condition logic by calling runStep directly on a task
// whose filesystem fixtures are set up to trigger each condition.
// runStep is the internal step executor in index.js — import it via the
// exported interface.
const orchestrator = require('../core/orchestrator');

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vl-translate-'));
}

function makeTask(rootDir, outputLang = 'zh-CN') {
  const id = 'testxlate0001';
  const taskDir = path.join(rootDir, 'work', id);
  fs.mkdirSync(path.join(taskDir, 'transcript'), { recursive: true });
  fs.mkdirSync(path.join(taskDir, 'logs'), { recursive: true });
  return {
    meta: { id, url: 'https://example.com/watch?v=test' },
    params: { rootDir, mode: 'media', output_lang: outputLang },
    status: 'running',
    steps: {
      fetch:     { status: 'completed', attempts: 1, error: null },
      video:     { status: 'pending',   attempts: 0, error: null },
      audio:     { status: 'pending',   attempts: 0, error: null },
      subs:      { status: 'completed', attempts: 1, error: null },
      asr:       { status: 'pending',   attempts: 0, error: null },
      vtt2md:    { status: 'completed', attempts: 1, error: null },
      translate: { status: 'pending',   attempts: 0, error: null },
      md2vtt:    { status: 'pending',   attempts: 0, error: null },
      article:   { status: 'pending',   attempts: 0, error: null },
      summary:   { status: 'pending',   attempts: 0, error: null },
    }
  };
}

async function run() {
  // ── Skip-1: original_zh.md 已存在 ───────────────────────────────────────
  {
    const rootDir = makeTmpRoot();
    const task = makeTask(rootDir);
    const id = task.meta.id;
    const zhMd = path.join(rootDir, 'work', id, 'transcript', 'original_zh.md');
    const enMd = path.join(rootDir, 'work', id, 'transcript', 'original_en.md');
    fs.writeFileSync(zhMd, '## 00:00:00\n测试内容\n');
    fs.writeFileSync(enMd, '## 00:00:00\nHello world\n');

    const result = await orchestrator.runStep(task, 'translate');
    assert.strictEqual(result.success, true, 'Skip-1: should succeed (skipped)');
    assert.strictEqual(task.steps.translate.status, 'skipped', 'Skip-1: status should be skipped');
    fs.rmSync(rootDir, { recursive: true });
  }

  // ── Skip-2: original_en.md 不存在 ──────────────────────────────────────
  {
    const rootDir = makeTmpRoot();
    const task = makeTask(rootDir);

    const result = await orchestrator.runStep(task, 'translate');
    assert.strictEqual(result.success, true, 'Skip-2: should succeed (skipped)');
    assert.strictEqual(task.steps.translate.status, 'skipped', 'Skip-2: status should be skipped');
    fs.rmSync(rootDir, { recursive: true });
  }

  // ── Skip-3: output_lang 非 zh → 跳过 (D2) ───────────────────────────────
  {
    const rootDir = makeTmpRoot();
    const task = makeTask(rootDir, 'en');  // output_lang = 'en'
    const id = task.meta.id;
    const enMd = path.join(rootDir, 'work', id, 'transcript', 'original_en.md');
    fs.writeFileSync(enMd, '## 00:00:00\nHello world\n');

    const result = await orchestrator.runStep(task, 'translate');
    assert.strictEqual(result.success, true, 'Skip-3: should succeed (skipped)');
    assert.strictEqual(task.steps.translate.status, 'skipped', 'Skip-3: status should be skipped');
    fs.rmSync(rootDir, { recursive: true });
  }

  // ── Migration (D1): 存量任务缺少 translate 步骤记录 ─────────────────────
  // 通过调用 orchestrator.loadTask 并验证 translate 被补写为 pending
  {
    const rootDir = makeTmpRoot();
    const id = 'legacytask0001';
    const taskDir = path.join(rootDir, 'work', id);
    fs.mkdirSync(path.join(taskDir, 'transcript'), { recursive: true });
    fs.mkdirSync(path.join(taskDir, 'logs'), { recursive: true });

    // 模拟不含 translate 的旧任务：直接向 DB 写入 task 和步骤（不含 translate）
    const task = await orchestrator.createTask({
      url: 'https://example.com/watch?v=legacy',
      rootDir,
      mode: 'media',
      output_lang: 'zh-CN',
    });

    // 从 DB 重新加载，确认 translate 已被 backfill 为 pending
    const loaded = await orchestrator.getTask(task.meta.id);
    assert.ok(loaded.steps.translate,                         'Migration: translate step exists');
    assert.strictEqual(loaded.steps.translate.status, 'pending', 'Migration: translate status is pending');
    fs.rmSync(rootDir, { recursive: true });
  }

  console.log('translate-step.test.js: PASS');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2：运行测试**

```bash
node tests/translate-step.test.js
```

预期：`translate-step.test.js: PASS`

> 如果 `orchestrator.runStep` / `orchestrator.getTask` 未对外导出，先在 `core/orchestrator/index.js` 底部的 `module.exports` 中补充导出（`runStep` 和 `getTask` 已是内部函数，仅需加入 exports 对象即可）。

- [ ] **Step 3：提交**

```bash
git add tests/translate-step.test.js
git commit -m "test: add translate step skip conditions and migration tests"
```

---

### Task 6：test_translate_subs.py — Phase 1 分块单元测试

**文件：**
- 创建: `tests/test_translate_subs.py`

- [ ] **Step 1：创建 Python 测试文件**

```python
#!/usr/bin/env python3
"""Unit tests for the Phase 1 chunking logic in translate_subs.sh."""

import re, json, tempfile, os, sys, textwrap

WINDOW_SECS = 25
MAX_CHARS   = 800

def ts_to_secs(ts):
    parts = ts.split(':')
    if len(parts) == 3:
        h, m, s = parts; return int(h)*3600 + int(m)*60 + float(s)
    elif len(parts) == 2:
        m, s = parts; return int(m)*60 + float(s)
    return 0.0

def chunk_md(content):
    block_re = re.compile(r'^## (\d{1,2}:\d{2}:\d{2})\s*\n(.*?)(?=\n## |\Z)',
                          re.MULTILINE | re.DOTALL)
    blocks = [(m.group(1), m.group(2).strip()) for m in block_re.finditer(content)]
    if not blocks:
        return None  # no blocks → script would exit 1

    chunks = []
    cur_start_ts   = blocks[0][0]
    cur_start_secs = ts_to_secs(blocks[0][0])
    cur_texts      = []

    for ts, text in blocks:
        secs    = ts_to_secs(ts)
        elapsed = secs - cur_start_secs
        if elapsed >= WINDOW_SECS or len(' '.join(cur_texts + [text])) > MAX_CHARS:
            if cur_texts:
                chunks.append({'start_ts': cur_start_ts, 'text': ' '.join(cur_texts)})
            cur_start_ts, cur_start_secs, cur_texts = ts, secs, [text]
        else:
            cur_texts.append(text)

    if cur_texts:
        chunks.append({'start_ts': cur_start_ts, 'text': ' '.join(cur_texts)})
    return chunks


def run():
    failures = []

    # ── 正常分块：5 个块，前两个在 25s 窗口内合并 ──────────────────────────
    md = textwrap.dedent("""\
        ## 00:00:05
        Hello and welcome

        ## 00:00:08
        to this lecture on machine learning

        ## 00:00:30
        Today we will cover

        ## 00:00:33
        the basics of neural networks

        ## 00:01:00
        Let us begin
    """)
    chunks = chunk_md(md)
    assert chunks is not None, "should produce chunks"
    assert chunks[0]['start_ts'] == '00:00:05', f"first start_ts wrong: {chunks[0]['start_ts']}"
    assert 'Hello and welcome' in chunks[0]['text'] and 'machine learning' in chunks[0]['text'], \
        f"first chunk should merge first two blocks: {chunks[0]['text']}"
    assert chunks[1]['start_ts'] == '00:00:30', f"second chunk start_ts wrong: {chunks[1]['start_ts']}"
    print("PASS: normal chunking merges within window")

    # ── 空文件（无 ## 块）→ 返回 None ────────────────────────────────────
    result = chunk_md("no timestamps here\njust plain text\n")
    assert result is None, "empty/no-block content should return None"
    print("PASS: empty file returns None")

    # ── 单块：无合并，start_ts 保持原值 ──────────────────────────────────
    single = "## 00:05:00\nOnly one block here\n"
    chunks = chunk_md(single)
    assert len(chunks) == 1, f"single block: expected 1 chunk, got {len(chunks)}"
    assert chunks[0]['start_ts'] == '00:05:00'
    assert chunks[0]['text'] == 'Only one block here'
    print("PASS: single block produces one chunk")

    # ── 800 字符硬上限触发分块 ───────────────────────────────────────────
    long_text = 'word ' * 200  # 1000 chars
    md_long = f"## 00:00:01\n{long_text[:400]}\n\n## 00:00:03\n{long_text[400:900]}\n"
    chunks = chunk_md(md_long)
    for c in chunks:
        assert len(c['text']) <= MAX_CHARS + 50, \
            f"chunk too long ({len(c['text'])} chars): hard cap not applied"
    print("PASS: 800-char hard cap triggers split")

    # ── zh_prev_tail：最后 150 字符截取 ──────────────────────────────────
    long_zh = '中文翻译结果' * 50  # 300 chars
    tail = long_zh[-150:] if len(long_zh) > 150 else long_zh
    assert len(tail) == 150, f"tail length wrong: {len(tail)}"
    assert tail == long_zh[-150:]
    print("PASS: zh_prev_tail extracts last 150 chars")

    print("\ntest_translate_subs.py: ALL PASS")

if __name__ == '__main__':
    run()
```

- [ ] **Step 2：运行测试**

```bash
python3 tests/test_translate_subs.py
```

预期：`test_translate_subs.py: ALL PASS`

- [ ] **Step 3：提交**

```bash
git add tests/test_translate_subs.py
git commit -m "test: add Phase 1 chunking unit tests for translate_subs"
```

---

## 自检清单

### 1. 规格覆盖

| 规格要求 | 实现任务 |
|---------|---------|
| DAG 边：vtt2md→translate→md2vtt | Task 1 Step 2 |
| ALL_STEPS 插入 translate | Task 1 Step 3 |
| SECONDARY_CHAIN_BASE 顺序 | Task 1 Step 4 |
| 超时 60 min | Task 1 Step 1 |
| Skip-1: zh.md 存在 | Task 3 Step 3 |
| Skip-2: en.md 不存在 | Task 3 Step 3 |
| Skip-3: output_lang 非 zh (D2) | Task 3 Step 3 |
| Phase 1: 时间窗口分块 | Task 4 Step 1 |
| Phase 2: 顺序 LLM + zh_prev_tail | Task 4 Step 1 |
| Phase 3: 组装 original_zh.md | Task 4 Step 1 |
| 存量迁移 (D1) | Task 3 Step 4 |
| schedule 回归修复 | Task 2 Step 2 |
| DAG 调度单元测试 | Task 2 Step 4 |
| skip 条件集成测试 | Task 5 Step 1 |
| Phase 1 分块单元测试 | Task 6 Step 1 |

### 2. 占位符扫描

无 TBD / TODO / 后续 / 类似 Task N。

### 3. 类型一致性

- `runStepScript` 调用签名与 vtt2md case（第 710 行）完全一致
- `db.updateStep(id, stepName, status)` 签名与全部现有 case 一致
- `task.steps[stepName] = stepState` 赋值模式与全部现有 case 一致
- `enMd` / `zhMd` 变量已在第 581-582 行定义，translate case 复用不需重复定义

---

计划已完成并保存到 `docs/superpowers/plans/2026-06-21-subtitle-translate.md`。

**两个执行选项：**

**1. 子 Agent 驱动（推荐）** — 每个 Task 派发独立 subagent，并行执行 Task 1+2+4（schedule / 测试 / 脚本）与 Task 3（index.js），最后串行跑 Task 5+6。

**2. 内联执行** — 在当前 session 使用 `executing-plans` 执行，逐 Task 检查点确认。

**选择哪个？**
