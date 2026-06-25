# Orchestrator 重构实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将单体 bash 脚本拆分为独立的步骤脚本 + Node.js 编排层，使前端能够精细控制每个子任务

**Architecture:** Node.js 编排层 (orchestrator.js) 调度 7 个独立步骤脚本，前置条件检查通过文件系统完成

**Tech Stack:** Node.js, bash scripts, JSON (meta.json)

---

## 阶段 1: 创建独立步骤脚本

### Task 1: 创建音频下载脚本

**Files:**
- Create: `scripts/download_audio.sh`

**Step 1: 创建脚本**

```bash
#!/bin/bash
# Audio download - independent step
# Usage: bash scripts/download_audio.sh <URL> <DIR> [FORCE]

URL="$1"
DIR="$2"
FORCE="${3:-0}"

if [ -z "$URL" ] || [ -z "$DIR" ]; then
    echo "Usage: download_audio.sh <URL> <DIR> [FORCE]"
    exit 1
fi

mkdir -p "$DIR/media"

echo "[STATUS] audio_start"

# Check if already exists
if [ "$FORCE" = "0" ] && ls "$DIR/media/audio."* 1>/dev/null 2>&1; then
    echo "[STATUS] audio_done"
    echo "[STATUS] audio_skipped_existing"
    exit 0
fi

# Clean temp files
rm -f "$DIR/media/audio."* 2>/dev/null || true

# Download audio
yt-dlp -x --audio-format m4a -o "$DIR/media/audio.%(ext)s" "$URL" 2>&1

if ls "$DIR/media/audio."* 1>/dev/null 2>&1; then
    echo "[STATUS] audio_done"
    exit 0
else
    echo "[STATUS] audio_error: download failed"
    exit 1
fi
```

**Step 2: 测试脚本**

Run: `bash scripts/download_audio.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" "work/test_audio"`

**Step 3: Commit**

```bash
git add scripts/download_audio.sh
git commit -m "feat: add download_audio.sh step script"
```

---

### Task 2: 创建字幕下载脚本

**Files:**
- Create: `scripts/download_subs.sh`

**Step 1: 创建脚本**

参考 run.sh 中字幕下载逻辑，提取为独立脚本。接收参数：
- `$1`: URL
- `$2`: 输出目录

输出文件到 `$DIR/transcript/subs/`

**Step 2: 测试脚本**

Run: `bash scripts/download_subs.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ" "work/test_subs"`

**Step 3: Commit**

```bash
git add scripts/download_subs.sh
git commit -m "feat: add download_subs.sh step script"
```

---

### Task 3: 创建 VTT→MD 转换脚本

**Files:**
- Create: `scripts/convert_vtt_md.sh`

**Step 1: 创建脚本**

接收参数：
- `$1`: VTT 文件路径
- `$2`: 输出 MD 文件路径

调用 `python3 scripts/vtt_converter.py`

**Step 2: 测试脚本**

Run: `bash scripts/convert_vtt_md.sh "work/test_subs/subs/test.en.vtt" "work/test_subs/original_en.md"`

**Step 3: Commit**

```bash
git add scripts/convert_vtt_md.sh
git commit -m "feat: add convert_vtt_md.sh step script"
```

---

### Task 4: 创建 MD→VTT 转换脚本

**Files:**
- Create: `scripts/convert_md_vtt.sh`

**Step 1: 创建脚本**

接收参数：
- `$1`: MD 文件路径
- `$2`: 输出 VTT 文件路径

调用 `python3 scripts/md2subtitle.py`

**Step 2: 测试脚本**

Run: `bash scripts/convert_md_vtt.sh "work/test_subs/original_en.md" "work/test_subs/original_en.vtt"`

**Step 3: Commit**

```bash
git add scripts/convert_md_vtt.sh
git commit -m "feat: add convert_md_vtt.sh step script"
```

---

### Task 5: 创建文章生成脚本

**Files:**
- Create: `scripts/generate_article.sh`

**Step 1: 创建脚本**

接收参数：
- `$1`: 逐字稿路径 (original_en.md 或 original_zh.md)
- `$2`: 输出路径 (article.md)
- `$3`: 输出语言 (可选，默认 zh-CN)

调用 Claude CLI 生成文章

**Step 2: 测试脚本**

Run: `bash scripts/generate_article.sh "work/test_subs/original_en.md" "work/test_subs/article.md"`

**Step 3: Commit**

```bash
git add scripts/generate_article.sh
git commit -m "feat: add generate_article.sh step script"
```

---

### Task 6: 创建总结生成脚本

**Files:**
- Create: `scripts/generate_summary.sh`

**Step 1: 创建脚本**

接收参数：
- `$1`: 文章路径 (article.md)
- `$2`: FOCUS
- `$3`: 输出路径 (summary.md)
- `$4`: 输出语言 (可选)

调用 Claude CLI 生成总结

**Step 2: 测试脚本**

Run: `bash scripts/generate_summary.sh "work/test_subs/article.md" "技术细节" "work/test_subs/summary.md"`

**Step 3: Commit**

```bash
git add scripts/generate_summary.sh
git commit -m "feat: add generate_summary.sh step script"
```

---

## 阶段 2: 创建编排层

### Task 7: 创建 orchestrator.js

**Files:**
- Create: `electron/src/orchestrator.js`

**Step 1: 创建编排层框架**

```javascript
// electron/src/orchestrator.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STEPS = {
    video: 'download_video.sh',
    audio: 'download_audio.sh',
    subs: 'download_subs.sh',
    vtt2md: 'convert_vtt_md.sh',
    md2vtt: 'convert_md_vtt.sh',
    article: 'generate_article.sh',
    summary: 'generate_summary.sh'
};

class Orchestrator {
    constructor(baseDir) {
        this.baseDir = baseDir;
    }

    // 生成任务 ID
    generateId(url) {
        return crypto.createHash('sha1').update(url).digest('hex').substring(0, 12);
    }

    // 读取 meta.json
    getMeta(id) {
        const metaPath = path.join(this.baseDir, 'work', id, 'transcript', 'meta.json');
        if (!fs.existsSync(metaPath)) return null;
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    }

    // 写入 meta.json
    saveMeta(id, meta) {
        const metaPath = path.join(this.baseDir, 'work', id, 'transcript', 'meta.json');
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    // 执行步骤脚本
    async runStepScript(step, args) {
        return new Promise((resolve, reject) => {
            const script = path.join(this.baseDir, 'scripts', STEPS[step]);
            const proc = spawn('bash', [script, ...args], { cwd: this.baseDir });

            let output = '';
            proc.stdout.on('data', (data) => { output += data.toString(); });
            proc.stderr.on('data', (data) => { output += data.toString(); });

            proc.on('close', (code) => {
                resolve({ code, output });
            });
        });
    }

    // TODO: 实现各 API 方法
}

module.exports = Orchestrator;
```

**Step 2: Commit**

```bash
git add electron/src/orchestrator.js
git commit -m "feat: add orchestrator.js framework"
```

---

### Task 8: 实现前置条件检查

**Files:**
- Modify: `electron/src/orchestrator.js`

**Step 1: 添加前置条件检查方法**

```javascript
    // 前置条件检查
    checkPrerequisites(id, step) {
        const errors = [];
        const dir = path.join(this.baseDir, 'work', id);

        switch (step) {
            case 'video':
                if (!fs.existsSync(path.join(dir, 'transcript', 'meta.json'))) {
                    errors.push('meta.json not found');
                }
                break;
            case 'audio':
                if (!fs.existsSync(path.join(dir, 'transcript', 'meta.json'))) {
                    errors.push('meta.json not found');
                }
                break;
            case 'subs':
                if (!fs.existsSync(path.join(dir, 'transcript', 'meta.json'))) {
                    errors.push('meta.json not found');
                }
                break;
            case 'vtt2md':
                const subsDir = path.join(dir, 'transcript', 'subs');
                const hasSubs = fs.existsSync(subsDir) &&
                    fs.readdirSync(subsDir).some(f => f.endsWith('.vtt'));
                if (!hasSubs) errors.push('No subtitle files found');
                break;
            case 'md2vtt':
                const enMd = path.join(dir, 'transcript', 'original_en.md');
                const zhMd = path.join(dir, 'transcript', 'original_zh.md');
                if (!fs.existsSync(enMd) && !fs.existsSync(zhMd)) {
                    errors.push('No transcript file found');
                }
                break;
            case 'article':
                const transcriptFile = fs.existsSync(path.join(dir, 'transcript', 'original_en.md'))
                    ? path.join(dir, 'transcript', 'original_en.md')
                    : fs.existsSync(path.join(dir, 'transcript', 'original_zh.md'))
                        ? path.join(dir, 'transcript', 'original_zh.md')
                        : null;
                if (!transcriptFile) errors.push('No transcript file found');
                break;
            case 'summary':
                if (!fs.existsSync(path.join(dir, 'writing', 'article.md'))) {
                    errors.push('article.md not found');
                }
                break;
        }

        return errors;
    }
```

**Step 2: Commit**

```bash
git add electron/src/orchestrator.js
git commit -m "feat: add prerequisite checking in orchestrator"
```

---

### Task 9: 实现 API 方法

**Files:**
- Modify: `electron/src/orchestrator.js`

**Step 1: 实现 runStep 方法**

```javascript
    // 单步执行
    async runStep(id, stepName, options = {}) {
        const { focus = '', force = false } = options;

        // 前置检查
        const errors = this.checkPrerequisites(id, stepName);
        if (errors.length > 0) {
            return { success: false, error: errors.join(', ') };
        }

        const meta = this.getMeta(id);
        const dir = path.join(this.baseDir, 'work', id);
        const url = meta.url;

        // 更新状态
        meta.current_step = stepName;
        meta.step_status = 'running';
        meta.steps = meta.steps || {};
        meta.steps[stepName] = { status: 'running', attempts: (meta.steps[stepName]?.attempts || 0) + 1, error: null };
        this.saveMeta(id, meta);

        // 执行脚本
        let args = [];
        switch (stepName) {
            case 'video':
                args = [url, dir, force ? '1' : '0'];
                break;
            case 'audio':
                args = [url, dir, force ? '1' : '0'];
                break;
            case 'subs':
                args = [url, dir];
                break;
            case 'vtt2md':
                // 自动找到所有 VTT 文件并转换
                const subsDir = path.join(dir, 'transcript', 'subs');
                const vttFiles = fs.readdirSync(subsDir).filter(f => f.endsWith('.vtt'));
                for (const vtt of vttFiles) {
                    const lang = vtt.match(/\.([^.]+)\./)?.[1] || 'en';
                    const outPath = path.join(dir, 'transcript', `original_${lang}.md`);
                    await this.runStepScript('vtt2md', [path.join(subsDir, vtt), outPath]);
                }
                break;
            case 'md2vtt':
                const enMd = path.join(dir, 'transcript', 'original_en.md');
                if (fs.existsSync(enMd)) {
                    await this.runStepScript('md2vtt', [enMd, enMd.replace('.md', '.vtt')]);
                }
                const zhMd = path.join(dir, 'transcript', 'original_zh.md');
                if (fs.existsSync(zhMd)) {
                    await this.runStepScript('md2vtt', [zhMd, zhMd.replace('.md', '.vtt')]);
                }
                break;
            case 'article':
                const transcriptPath = fs.existsSync(enMd) ? enMd : zhMd;
                args = [transcriptPath, path.join(dir, 'writing', 'article.md'), meta.output_lang || 'zh-CN'];
                break;
            case 'summary':
                args = [
                    path.join(dir, 'writing', 'article.md'),
                    focus || meta.focus || '',
                    path.join(dir, 'writing', 'summary.md'),
                    meta.output_lang || 'zh-CN'
                ];
                break;
        }

        if (args.length > 0) {
            const result = await this.runStepScript(stepName, args);
            meta.steps[stepName].status = result.code === 0 ? 'completed' : 'failed';
            if (result.code !== 0) {
                meta.steps[stepName].error = result.output;
            }
        }

        meta.step_status = meta.steps[stepName].status;
        this.saveMeta(id, meta);

        return { success: meta.steps[stepName].status === 'completed', output: meta.steps[stepName].error || 'done' };
    }
```

**Step 2: 实现其他方法**

实现：
- `run(url, options)` - 全部执行
- `retryStep(id, stepName)` - 重试步骤
- `skipStep(id, stepName)` - 跳过步骤
- `getStatus(id)` - 查看状态

**Step 3: Commit**

```bash
git add electron/src/orchestrator.js
git commit -m "feat: implement orchestrator API methods"
```

---

## 阶段 3: 集成到 Electron

### Task 10: 更新 main.js 使用编排层

**Files:**
- Modify: `electron/src/main.js`

**Step 1: 引入编排层**

```javascript
const Orchestrator = require('./orchestrator');
const orchestrator = new Orchestrator(path.join(__dirname, '../..'));
```

**Step 2: 替换 run-pipeline handler**

修改 `ipcMain.handle('run-pipeline', ...)` 使用编排层 API

**Step 3: 添加新 API handlers**

添加：
- `run-step`: 单步执行
- `retry-step`: 重试步骤
- `skip-step`: 跳过步骤
- `get-task-status`: 查看状态

**Step 4: Commit**

```bash
git add electron/src/main.js
git commit -m "feat: integrate orchestrator into Electron main.js"
```

---

### Task 11: 更新 preload.js

**Files:**
- Modify: `electron/src/preload.js`

**Step 1: 添加新 API**

```javascript
runStep: (id, step, options) => ipcRenderer.invoke('run-step', { id, step, options }),
retryStep: (id, step) => ipcRenderer.invoke('retry-step', { id, step }),
skipStep: (id, step) => ipcRenderer.invoke('skip-step', { id, step }),
getTaskStatus: (id) => ipcRenderer.invoke('get-task-status', id),
```

**Step 2: Commit**

```bash
git add electron/src/preload.js
git commit -m "feat: expose orchestrator APIs in preload"
```

---

## 阶段 4: 测试与验证

### Task 12: 端到端测试

**Step 1: 启动 Electron 应用**

**Step 2: 测试完整流程**

1. 添加新任务 → 验证所有步骤正常执行
2. 测试单步执行 → 验证前置检查工作
3. 测试跳过步骤 → 验证状态更新
4. 测试步骤重试 → 验证重试逻辑

**Step 3: Commit**

```bash
git commit -m "test: add e2e tests for orchestrator"
```

---

## 执行选项

**Plan complete and saved to `docs/plans/2026-03-06-orchestrator-design.md`. Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
