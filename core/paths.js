'use strict';

const path = require('path');

/**
 * Compute the absolute work root directory for a given project root.
 *
 * In this project, all runtime artifacts live under "<rootDir>/work".
 * This helper centralizes that convention so HTTP, Electron and other
 * entrypoints can share the same logic.
 *
 * @param {string} rootDir Absolute path to the project root/worktree
 * @returns {string} Absolute path to the work directory
 */
function getWorkRoot(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('getWorkRoot requires a non-empty rootDir string');
  }
  return path.resolve(rootDir, 'work');
}

/**
 * Compute key task directories under the work root.
 *
 * Layout:
 *   <workRoot>/<taskId>/           -> base
 *   <workRoot>/<taskId>/media/    -> media
 *   <workRoot>/<taskId>/transcript-> transcript
 *   <workRoot>/<taskId>/writing/  -> writing
 *
 * This mirrors the structure used by core/orchestrator and CLAUDE.md.
 *
 * @param {string} rootDir Absolute path to project root/worktree
 * @param {string} taskId  Logical task id (same as meta.id)
 * @returns {{ base: string, media: string, transcript: string, writing: string }}
 */
function getTaskDirs(rootDir, taskId) {
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('getTaskDirs requires a non-empty taskId string');
  }
  const workRoot = getWorkRoot(rootDir);
  const base = path.join(workRoot, taskId);
  return {
    base,
    media:      path.join(base, 'media'),
    transcript: path.join(base, 'transcript'),
    writing:    path.join(base, 'writing'),
    notes:      path.join(base, 'notes.json'),
  };
}

module.exports = {
  getWorkRoot,
  getTaskDirs,
};

