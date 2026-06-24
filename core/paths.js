'use strict';

const fs = require('fs');
const path = require('path');
const { USER_CONFIG_PATH, DEFAULT_WORK_ROOT } = require('./user-config');

/**
 * Expand a leading ~ and $VAR / ${VAR} references against process.env.
 */
function expandPath(value) {
  let out = String(value).trim();
  if (out === '~') {
    out = process.env.HOME || out;
  } else if (out.startsWith('~/')) {
    out = path.join(process.env.HOME || '', out.slice(2));
  }
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b) => {
    const name = a || b;
    return process.env[name] != null ? process.env[name] : '';
  });
  return out;
}

/**
 * Read a single KEY=value from a bash-style settings file (last assignment wins,
 * surrounding quotes stripped). Returns null if file missing or key absent/empty.
 */
function readSettingValue(settingsPath, key) {
  let text;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch (_) {
    return null;
  }
  let val = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && m[1] === key) val = m[2];
  }
  if (val == null) return null;
  val = val.replace(/^["']/, '').replace(/["']$/, '');
  return val;
}

/**
 * Resolve the configurable WORK *root* (the parent under which "work/" lives).
 * Order: env WORK_ROOT > VDL_CONFIG_FILE (or ~/.config/vdl/settings.conf) WORK_ROOT > ~/vdl-work.
 * rootDir param retained for API compatibility; no longer used for config resolution.
 */
function resolveWorkBase(rootDir) {
  // rootDir retained for API compatibility; no longer used for config lookup.
  let raw = process.env.WORK_ROOT;
  if (!raw || !raw.trim()) {
    const cfgPath = process.env.VDL_CONFIG_FILE || USER_CONFIG_PATH;
    raw = readSettingValue(cfgPath, 'WORK_ROOT');
  }
  if (!raw || !raw.trim()) return DEFAULT_WORK_ROOT;
  const resolved = path.resolve(expandPath(raw));
  return resolved.replace(/\/+$/, '') || '/';
}

/**
 * Absolute work directory: "<resolvedRoot>/work". All per-task folders live here.
 */
function getWorkRoot(rootDir) {
  return path.join(resolveWorkBase(rootDir), 'work');
}

/**
 * Absolute path to the SQLite database.
 */
function getDbPath(rootDir) {
  return path.join(getWorkRoot(rootDir), 'database.sqlite');
}

/**
 * Absolute path to the audit index.jsonl.
 */
function getIndexPath(rootDir) {
  return path.join(getWorkRoot(rootDir), 'index.jsonl');
}

/**
 * Compute key task directories under the work root.
 *   <workRoot>/<taskId>/{media,transcript,writing}, plus notes.json
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

/**
 * Write (or update) WORK_ROOT in a bash-style settings file.
 * Removes any existing uncommented WORK_ROOT= lines, then appends the new value.
 * Creates the file if it doesn't exist.
 */
function writeWorkRoot(settingsPath, value) {
  let lines = [];
  try {
    lines = fs.readFileSync(settingsPath, 'utf8').split(/\r?\n/);
  } catch (_) {}
  const filtered = lines.filter(l => !l.match(/^\s*WORK_ROOT\s*=/));
  filtered.push(`WORK_ROOT=${value}`);
  const content = filtered.join('\n').replace(/\n{3,}/g, '\n\n');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, content.endsWith('\n') ? content : content + '\n', 'utf8');
}

module.exports = {
  resolveWorkBase,
  getWorkRoot,
  getDbPath,
  getIndexPath,
  getTaskDirs,
  writeWorkRoot,
};
