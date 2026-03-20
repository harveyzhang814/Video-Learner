#!/usr/bin/env node
/**
 * Ingest a step raw log file into work/<id>/logs/task.log.jsonl (JSONL).
 * - De-dup: based on raw file signature (size + mtimeMs)
 * - Parsing: yt-dlp progress template lines, plus light ffmpeg/error heuristics
 *
 * Usage:
 *   node scripts/ingest_task_logs.js \
 *     --task-dir work/<id> --step video \
 *     --raw-path work/<id>/logs/video.raw.log \
 *     --jsonl-path work/<id>/logs/task.log.jsonl
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseYtDlpProgressLine(line) {
  if (!line) return null;
  const m = line.match(/^\[progress\]\s+downloaded=(\d+)\s+total=(\d+)\s+speed=([\d.]+)\s+eta=(\d+)/);
  if (!m) return null;
  const downloaded = Number(m[1]);
  const total = Number(m[2]);
  const speed = Number(m[3]);
  const eta = Number(m[4]);
  if (!Number.isFinite(downloaded) || downloaded < 0) return null;
  if (!Number.isFinite(total) || total < 0) return null;
  return {
    downloaded,
    total,
    speed: Number.isFinite(speed) ? speed : 0,
    eta: Number.isFinite(eta) ? eta : 0
  };
}

function getLevel(line) {
  if (!line) return 'info';
  if (/exception|traceback|error|failed|Error|Failed/i.test(line)) return 'error';
  if (/warning|warn|WARN/i.test(line)) return 'warn';
  return 'info';
}

function getSourceAndProgress(line) {
  const parsed = parseYtDlpProgressLine(line.trim());
  if (parsed) {
    const { downloaded, total, speed, eta } = parsed;
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((downloaded / total) * 100))) : null;
    return { source: 'yt-dlp', progress: { downloaded, total, speed, eta, percent } };
  }
  if (/\bframe\s*=\s*\d+/.test(line) || /\btime\s*=\s*\d{2}:\d{2}:\d{2}/.test(line)) {
    return { source: 'ffmpeg' };
  }
  return { source: 'script/other' };
}

function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function loadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function saveJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function main() {
  const taskDir = getArg('task-dir');
  const step = getArg('step');
  const rawPath = getArg('raw-path');
  const jsonlPath = getArg('jsonl-path') || path.join(taskDir, 'logs', 'task.log.jsonl');
  const attemptStr = getArg('attempt');
  const attempt = attemptStr ? Number(attemptStr) : 1;

  if (!taskDir || !step || !rawPath) {
    console.error('Missing required args: --task-dir --step --raw-path');
    process.exit(2);
  }

  if (!fs.existsSync(rawPath)) {
    // Nothing to ingest.
    return;
  }

  fs.mkdirSync(path.join(taskDir, 'logs'), { recursive: true });

  const stat = fs.statSync(rawPath);
  const signature = `${stat.size}:${Number(stat.mtimeMs).toFixed(0)}`;

  const markerPath = path.join(taskDir, 'logs', 'ingest_markers.json');
  const markers = loadJson(markerPath);
  const key = `${step}:${path.resolve(rawPath)}`;
  if (markers[key] === signature) {
    return;
  }

  const content = fs.readFileSync(rawPath, 'utf8');
  const lines = content.split(/\r?\n/);

  const records = [];
  for (const line of lines) {
    const trimmed = String(line || '').trimEnd();
    if (!trimmed.trim()) continue;
    const ts = new Date().toISOString();
    const { source, progress } = getSourceAndProgress(trimmed);
    const level = getLevel(trimmed);
    const record = {
      ts,
      taskId: path.basename(taskDir),
      step,
      attempt,
      stream: 'unknown',
      source,
      level,
      line: trimmed
    };
    if (progress) record.progress = progress;
    records.push(record);
  }

  if (records.length) {
    const out = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    fs.appendFileSync(jsonlPath, out, 'utf8');
  }

  markers[key] = signature;
  saveJson(markerPath, markers);
}

main();

