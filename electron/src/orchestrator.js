const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STEPS = {
    fetch: 'fetch_info.sh',       // task0: 获取视频元信息（标题、时长、封面等）
    video: 'download_video.sh',
    audio: 'download_audio.sh',
    subs: 'download_subs.sh',
    vtt2md: 'convert_vtt_md.sh',
    md2vtt: 'convert_md_vtt.sh',
    article: 'generate_article.sh',
    summary: 'generate_summary.sh'
};

class Orchestrator {
    constructor(baseDir, onOutput = null, onTaskCreated = null, onTaskUpdated = null) {
        this.baseDir = baseDir;
        this.onOutput = onOutput;
        this.onTaskCreated = onTaskCreated;
        this.onTaskUpdated = onTaskUpdated;
    }

    // 设置输出回调
    setOutputCallback(callback) {
        this.onOutput = callback;
    }

    // 设置任务创建回调
    setTaskCreatedCallback(callback) {
        this.onTaskCreated = callback;
    }

    // 设置任务更新回调
    setTaskUpdatedCallback(callback) {
        this.onTaskUpdated = callback;
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
        fs.mkdirSync(path.dirname(metaPath), { recursive: true });
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    // 执行步骤脚本
    runStepScript(step, args) {
        return new Promise((resolve, reject) => {
            const script = path.join(this.baseDir, 'scripts', STEPS[step]);
            console.log('[DEBUG] runStepScript:', step, args);
            const proc = spawn('bash', [script, ...args], { cwd: this.baseDir });

            let output = '';
            proc.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                if (this.onOutput) {
                    this.onOutput(text);
                }
            });
            proc.stderr.on('data', (data) => {
                const text = data.toString();
                output += text;
                if (this.onOutput) {
                    this.onOutput(text);
                }
            });

            proc.on('close', (code) => {
                resolve({ code, output });
            });
        });
    }

    // 前置条件检查
    checkPrerequisites(id, step) {
        const errors = [];
        const dir = path.join(this.baseDir, 'work', id);

        switch (step) {
            case 'fetch':
                // fetch 不需要前置条件
                break;
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
                if (!hasSubs) errors.push('No subtitle files found in subs/');
                break;
            case 'md2vtt':
                const enMd = path.join(dir, 'transcript', 'original_en.md');
                const zhMd = path.join(dir, 'transcript', 'original_zh.md');
                if (!fs.existsSync(enMd) && !fs.existsSync(zhMd)) {
                    errors.push('No transcript file found (original_en.md or original_zh.md)');
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

    // 单步执行
    async runStep(id, stepName, options = {}) {
        const { focus = '', force = false } = options;

        // 前置检查
        const errors = this.checkPrerequisites(id, stepName);
        if (errors.length > 0) {
            return { success: false, error: errors.join(', ') };
        }

        const meta = this.getMeta(id);
        if (!meta) {
            return { success: false, error: 'Task not found' };
        }
        const dir = path.join(this.baseDir, 'work', id);
        const url = meta.url;

        // 更新状态
        meta.current_step = stepName;
        meta.step_status = 'running';
        meta.steps = meta.steps || {};
        meta.steps[stepName] = {
            status: 'running',
            attempts: (meta.steps[stepName]?.attempts || 0) + 1,
            error: null
        };
        this.saveMeta(id, meta);

        // 构建参数并执行
        let args = [];
        const enMd = path.join(dir, 'transcript', 'original_en.md');
        const zhMd = path.join(dir, 'transcript', 'original_zh.md');
        switch (stepName) {
            case 'fetch':
                args = [url, dir];
                break;
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
                const errors = [];
                for (const vtt of vttFiles) {
                    try {
                        const lang = vtt.match(/\.([^.]+)\./)?.[1] || 'en';
                        const outPath = path.join(dir, 'transcript', `original_${lang}.md`);
                        await this.runStepScript('vtt2md', [path.join(subsDir, vtt), outPath]);
                    } catch (e) {
                        errors.push(`${vtt}: ${e.message}`);
                    }
                }
                if (errors.length > 0) {
                    meta.steps[stepName].error = errors.join('\n');
                }
                break;
            case 'md2vtt':
                const mdErrors = [];
                if (fs.existsSync(enMd)) {
                    try {
                        await this.runStepScript('md2vtt', [enMd, enMd.replace('.md', '.vtt')]);
                    } catch (e) {
                        mdErrors.push(`original_en.md: ${e.message}`);
                    }
                }
                if (fs.existsSync(zhMd)) {
                    try {
                        await this.runStepScript('md2vtt', [zhMd, zhMd.replace('.md', '.vtt')]);
                    } catch (e) {
                        mdErrors.push(`original_zh.md: ${e.message}`);
                    }
                }
                if (mdErrors.length > 0) {
                    meta.steps[stepName].error = mdErrors.join('\n');
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
        } else {
            // vtt2md 和 md2vtt 已经内部执行完成
            meta.steps[stepName].status = 'completed';
        }

        meta.step_status = meta.steps[stepName].status;
        this.saveMeta(id, meta);

        return { success: meta.steps[stepName].status === 'completed', output: meta.steps[stepName].error || 'done' };
    }

    // 全部执行
    async run(url, options = {}) {
        const { downloadVideo = false, downloadAudio = false, focus = '', force = false } = options;

        console.log('[DEBUG] orchestrator.run called with:', { downloadVideo, downloadAudio, focus, force });

        // 生成 ID
        const id = this.generateId(url);
        const dir = path.join(this.baseDir, 'work', id);

        // 检查 meta 是否已存在
        const existingMeta = this.getMeta(id);
        if (existingMeta) {
            // 复用现有 meta，更新必要字段
            var meta = { ...existingMeta, ...{ id, url }, ts: new Date().toISOString(), output_lang: options.output_lang || existingMeta.output_lang || 'zh-CN' };
        } else {
            // 初始化 meta.json
            var meta = {
                id,
                url,
                ts: new Date().toISOString(),
                title: '',
                download_status: 'pending',
                transcript_done: false,
                article_done: false,
                summary_done: false,
                output_lang: options.output_lang || 'zh-CN'
            };
        }

        // 创建目录
        fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'transcript', 'subs'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'writing'), { recursive: true });

        this.saveMeta(id, meta);

        // Push task-created event
        if (this.onTaskCreated) {
            this.onTaskCreated({ id, url, ts: meta.ts });
        }

        // 依次执行步骤
        // Step 0: 获取视频元信息
        await this.runStep(id, 'fetch');

        // Push task-updated event after fetch completes
        if (this.onTaskUpdated) {
            const updatedMeta = this.getMeta(id);
            this.onTaskUpdated(updatedMeta);
        }

        console.log('[DEBUG] deciding download step:', { downloadVideo, downloadAudio });
        if (downloadVideo) {
            console.log('[DEBUG] executing video step');
            await this.runStep(id, 'video', { force });
        } else if (downloadAudio) {
            console.log('[DEBUG] executing audio step');
            await this.runStep(id, 'audio', { force });
        } else {
            console.log('[DEBUG] no media download, skipping to subs');
        }

        await this.runStep(id, 'subs');
        await this.runStep(id, 'vtt2md');
        await this.runStep(id, 'md2vtt');
        await this.runStep(id, 'article');

        if (focus || meta.focus) {
            await this.runStep(id, 'summary', { focus });
        }

        return { id, status: 'completed' };
    }

    // 重试步骤
    async retryStep(id, stepName) {
        const meta = this.getMeta(id);
        if (!meta) {
            return { success: false, error: 'Task not found' };
        }

        meta.steps = meta.steps || {};
        if (!meta.steps[stepName]) {
            return { success: false, error: 'Step not found in task history' };
        }
        meta.steps[stepName].error = null;

        return this.runStep(id, stepName);
    }

    // 跳过步骤
    skipStep(id, stepName) {
        const meta = this.getMeta(id);
        if (!meta) {
            return { success: false, error: 'Task not found' };
        }

        meta.steps = meta.steps || {};
        meta.steps[stepName] = { status: 'skipped', attempts: 0, error: null };
        meta.step_status = 'skipped';
        this.saveMeta(id, meta);

        return { success: true };
    }

    // 获取状态
    getStatus(id) {
        const meta = this.getMeta(id);
        if (!meta) {
            return null;
        }

        return {
            id: meta.id,
            url: meta.url,
            title: meta.title,
            current_step: meta.current_step,
            step_status: meta.step_status,
            steps: meta.steps || {},
            download_status: meta.download_status,
            transcript_done: meta.transcript_done,
            article_done: meta.article_done,
            summary_done: meta.summary_done
        };
    }
}

module.exports = Orchestrator;
