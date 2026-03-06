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
        fs.mkdirSync(path.dirname(metaPath), { recursive: true });
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    // 执行步骤脚本
    runStepScript(step, args) {
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
}

module.exports = Orchestrator;
