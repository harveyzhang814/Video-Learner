/**
 * Electron adapter: delegates to core/orchestrator and core/id so GUI and HTTP agent share the same logic.
 * Keeps getMeta/saveMeta for DB access (e.g. fetch_info.sh updates DB); run/runStep/retryStep/skipStep/getStatus use core.
 */
const path = require('path');
const DatabaseManager = require('./db');
const { generateId: coreGenerateId } = require('../../core/id');
const core = require('../../core/orchestrator');

function modeFromOptions(options = {}) {
  const { downloadVideo = false, downloadAudio = false } = options;
  if (downloadVideo && downloadAudio) return 'both';
  if (downloadVideo) return 'video';
  if (downloadAudio) return 'audio';
  return 'transcript';
}

class Orchestrator {
  constructor(baseDir, onOutput = null, onTaskCreated = null, onTaskUpdated = null, onStepEvent = null) {
    this.baseDir = baseDir;
    this.onOutput = onOutput;
    this.onTaskCreated = onTaskCreated;
    this.onTaskUpdated = onTaskUpdated;
    this.onStepEvent = onStepEvent;
    const dbPath = path.join(baseDir, 'work', 'database.sqlite');
    this.db = new DatabaseManager(dbPath);
  }

  setOutputCallback(callback) {
    this.onOutput = callback;
  }
  setTaskCreatedCallback(callback) {
    this.onTaskCreated = callback;
  }
  setTaskUpdatedCallback(callback) {
    this.onTaskUpdated = callback;
  }

  generateId(url) {
    return coreGenerateId(url);
  }

  getMeta(id) {
    return this.db.getTask(id);
  }

  saveMeta(id, meta) {
    let title = meta.title;
    let duration = meta.duration;
    if (!title || !duration) {
      const existing = this.db.getTask(id);
      if (existing) {
        title = title || existing.title;
        duration = duration || existing.duration;
      }
    }
    const updateData = {
      url: meta.url,
      title: title,
      lang: meta.lang,
      duration: duration,
      output_lang: meta.output_lang,
      focus: meta.focus
    };
    if (meta.transcripts) {
      this.db.updateTranscripts(id, meta.transcripts);
    }
    this.db.updateTask(id, updateData);
  }

  async run(url, options = {}) {
    const { focus = '', force = false } = options;
    const mode = modeFromOptions(options);
    const output_lang = options.output_lang || 'zh-CN';

    const task = await core.createTask({
      url,
      focus,
      mode,
      force: force ? 1 : 0,
      output_lang,
      rootDir: this.baseDir
    });
    const id = task.task_id;

    if (this.onTaskCreated) {
      this.onTaskCreated({ id, url, ts: task.meta.ts });
    }

    const opts = { rootDir: this.baseDir, onOutput: this.onOutput };

    await core.runStep(id, 'fetch', opts);
    let meta = this.db.getTask(id);
    if (this.onTaskUpdated && meta) {
      this.onTaskUpdated(meta);
    }

    if (mode === 'both' || mode === 'video') {
      await core.runStep(id, 'video', { ...opts, force });
    } else if (mode === 'audio') {
      await core.runStep(id, 'audio', { ...opts, force });
    }

    await core.runStep(id, 'subs', opts);
    await core.runStep(id, 'vtt2md', opts);
    await core.runStep(id, 'md2vtt', opts);
    await core.runStep(id, 'article', opts);

    const summaryFocus = focus || (meta && meta.focus) || '视频的主要内容和要点';
    await core.runStep(id, 'summary', { ...opts, focus: summaryFocus });

    if (this.onStepEvent) {
      this.onStepEvent('task:complete', { id });
    }
    return { id, status: 'completed' };
  }

  async runStep(id, stepName, options = {}) {
    const result = await core.runStep(id, stepName, {
      focus: options.focus,
      force: options.force,
      rootDir: this.baseDir,
      onOutput: this.onOutput
    });
    return { success: result.success, output: result.error || 'done' };
  }

  async retryStep(id, stepName) {
    return this.runStep(id, stepName, { force: true });
  }

  skipStep(id, stepName) {
    core.skipStep(id, stepName, { rootDir: this.baseDir });
    return { success: true };
  }

  async getStatus(id) {
    try {
      const task = await core.getTask(id, { rootDir: this.baseDir });
      if (!task) return null;
      const steps = task.steps || {};
      const stepStatus = Object.values(steps).some((s) => s.status === 'running') ? 'running' : 'completed';
      const current = Object.entries(steps).find(([, s]) => s.status === 'running');
      return {
        id: task.task_id,
        url: task.meta.url,
        title: task.meta.title || (this.db.getTask(id) && this.db.getTask(id).title) || '',
        current_step: current ? current[0] : null,
        step_status: stepStatus,
        steps: steps,
        download_status: task.meta.download_status,
        transcript_done: task.meta.transcript_done,
        article_done: task.meta.article_done,
        summary_done: task.meta.summary_done
      };
    } catch (e) {
      return null;
    }
  }
}

module.exports = Orchestrator;

