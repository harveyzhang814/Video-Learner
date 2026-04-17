'use strict';

const fs = require('fs');
const path = require('path');

function isNonEmptyString(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

function getTaskDir(rootDir, id) {
  return path.join(rootDir, 'work', id);
}

/**
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function canWriteOrCreateTaskDir(rootDir, id) {
  try {
    if (!isNonEmptyString(rootDir)) {
      return { ok: false, error: 'rootDir is missing' };
    }
    const absRoot = path.resolve(rootDir);
    if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
      return { ok: false, error: 'rootDir is not a directory' };
    }
    fs.accessSync(absRoot, fs.constants.W_OK);

    const taskDir = getTaskDir(absRoot, id);
    if (fs.existsSync(taskDir)) {
      if (!fs.statSync(taskDir).isDirectory()) {
        return { ok: false, error: 'Task path exists but is not a directory' };
      }
      fs.accessSync(taskDir, fs.constants.W_OK);
      return { ok: true };
    }

    const workDir = path.join(absRoot, 'work');
    if (fs.existsSync(workDir)) {
      if (!fs.statSync(workDir).isDirectory()) {
        return { ok: false, error: 'work/ exists but is not a directory' };
      }
      fs.accessSync(workDir, fs.constants.W_OK);
      return { ok: true };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.code === 'EACCES' ? 'Directory not writable' : e.message || 'Cannot use task directory' };
  }
}

function listOriginalMdFiles(transcriptDir) {
  if (!fs.existsSync(transcriptDir) || !fs.statSync(transcriptDir).isDirectory()) {
    return [];
  }
  return fs.readdirSync(transcriptDir).filter((f) => /^original_.+\.md$/.test(f));
}

function hasVttInSubs(subsDir) {
  if (!fs.existsSync(subsDir) || !fs.statSync(subsDir).isDirectory()) {
    return false;
  }
  return fs.readdirSync(subsDir).some((f) => f.endsWith('.vtt'));
}

/**
 * A-layer only: artifacts and environment. Does not read upstream step SQLite status.
 * @param {object} task - ensureTask shape: params.rootDir, params.mode, meta.id, meta.url
 * @param {string} stepName
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateStepArtifacts(task, stepName) {
  const rootDir = task.params && task.params.rootDir;
  const id = task.meta && task.meta.id;
  const url = task.meta && task.meta.url;

  if (!isNonEmptyString(id)) {
    return { ok: false, error: 'Task id is missing' };
  }

  const dir = getTaskDir(rootDir, id);
  const transcriptDir = path.join(dir, 'transcript');
  const subsDir = path.join(transcriptDir, 'subs');
  const articleMd = path.join(dir, 'writing', 'article.md');

  switch (stepName) {
    case 'fetch': {
      if (!isNonEmptyString(url)) {
        return { ok: false, error: 'url is required' };
      }
      const w = canWriteOrCreateTaskDir(rootDir, id);
      if (!w.ok) return w;
      return { ok: true };
    }
    case 'video':
    case 'audio':
    case 'subs': {
      if (!isNonEmptyString(url)) {
        return { ok: false, error: 'url is required' };
      }
      return canWriteOrCreateTaskDir(rootDir, id);
    }
    case 'asr': {
      const mediaDir = path.join(dir, 'media');
      const hasVideo = fs.existsSync(path.join(mediaDir, 'video.mp4'));
      const hasAudio = fs.existsSync(path.join(mediaDir, 'audio.m4a'));
      if (!hasVideo && !hasAudio) {
        return { ok: false, error: 'No media file found for ASR transcription' };
      }
      return { ok: true };
    }
    case 'vtt2md': {
      if (!fs.existsSync(subsDir) || !fs.statSync(subsDir).isDirectory()) {
        return { ok: false, error: 'transcript/subs directory does not exist' };
      }
      if (!hasVttInSubs(subsDir)) {
        return { ok: false, error: 'No .vtt files in transcript/subs' };
      }
      return { ok: true };
    }
    case 'md2vtt':
    case 'article': {
      const files = listOriginalMdFiles(transcriptDir);
      if (files.length === 0) {
        return { ok: false, error: 'No original_*.md transcript file found' };
      }
      return { ok: true };
    }
    case 'summary': {
      if (!fs.existsSync(articleMd) || !fs.statSync(articleMd).isFile()) {
        return { ok: false, error: 'writing/article.md not found' };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

module.exports = {
  isNonEmptyString,
  getTaskDir,
  canWriteOrCreateTaskDir,
  listOriginalMdFiles,
  hasVttInSubs,
  validateStepArtifacts
};
