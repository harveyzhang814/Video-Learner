#!/usr/bin/env node
'use strict';

/**
 * One-time backfill: probe existing media files with ffprobe and
 * write width, height, file_size, bit_rate back to the tasks table.
 *
 * Usage: node scripts/backfill_media_probe.js
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { createDb } = require('../core/orchestrator/db');

const ROOT_DIR = path.resolve(__dirname, '..');
const WORK_DIR = path.join(ROOT_DIR, 'work');

function probe(filePath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath,
    ], { encoding: 'utf8' });
    const data = JSON.parse(out);
    const video = (data.streams || []).find((s) => s.codec_type === 'video');
    const fmt = data.format || {};
    return {
      width:     video ? (video.width || null) : null,
      height:    video ? (video.height || null) : null,
      file_size: fmt.size ? parseInt(fmt.size, 10) : null,
      bit_rate:  fmt.bit_rate ? parseInt(fmt.bit_rate, 10) : null,
    };
  } catch {
    return null;
  }
}

function main() {
  const db = createDb(ROOT_DIR);

  const taskDirs = fs.readdirSync(WORK_DIR).filter((name) => {
    const p = path.join(WORK_DIR, name);
    return fs.statSync(p).isDirectory() && /^[0-9a-f]{12}$/.test(name);
  });

  let updated = 0;
  let skipped = 0;
  let noMedia = 0;

  for (const taskId of taskDirs) {
    const mediaDir = path.join(WORK_DIR, taskId, 'media');
    if (!fs.existsSync(mediaDir)) { noMedia++; continue; }

    // Prefer video.mp4, fall back to audio.m4a
    const candidates = ['video.mp4', 'audio.m4a'];
    let filePath = null;
    for (const name of candidates) {
      const p = path.join(mediaDir, name);
      if (fs.existsSync(p)) { filePath = p; break; }
    }
    if (!filePath) { noMedia++; continue; }

    const info = probe(filePath);
    if (!info) { skipped++; continue; }

    db.updateTask(taskId, info);
    const res = path.basename(filePath) === 'video.mp4'
      ? `${info.width}x${info.height}`
      : 'audio-only';
    const mb = info.file_size ? (info.file_size / 1024 / 1024).toFixed(1) + ' MB' : '?';
    console.log(`[ok] ${taskId}  ${res}  ${mb}`);
    updated++;
  }

  db.close();
  console.log(`\nDone. updated=${updated}  skipped=${skipped}  noMedia=${noMedia}`);
}

main();
