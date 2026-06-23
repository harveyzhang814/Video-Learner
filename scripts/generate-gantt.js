#!/usr/bin/env node
'use strict';

/**
 * 从 SQLite 读取任务的步骤时间戳，生成甘特图 HTML。
 *
 * 用法：
 *   node scripts/generate-gantt.js <task_id> [output.html]
 *   node scripts/generate-gantt.js <task_id>          # 输出到 stdout
 *
 * 需要后端已写入 started_at / completed_at（步骤执行后自动记录）。
 */

const fs   = require('fs');
const path = require('path');

const { createDb } = require('../core/orchestrator/db');
const { getTaskDirs } = require('../core/paths');

const TEMPLATE_PATH = path.join(__dirname, 'gantt-template.html');

// ── step → category mapping ────────────────────────────────────
const STEP_CAT = {
  fetch:     'fetch',
  video:     'download',
  audio:     'download',
  subs:      'download',
  asr:       'convert',
  vtt2md:    'convert',
  translate: 'ai',
  md2vtt:    'convert',
  article:   'ai',
  summary:   'ai',
};

// ── helpers ────────────────────────────────────────────────────
function parseTs(s) {
  if (!s) return null;
  const ms = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : null;
}

function fmtDate(ms) {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-');
}

// ── main ───────────────────────────────────────────────────────
function main() {
  const taskId = process.argv[2];
  const outArg = process.argv[3];

  if (!taskId) {
    console.error('用法: node scripts/generate-gantt.js <task_id> [output.html]');
    process.exit(1);
  }

  const rootDir = process.env.WORK_ROOT
    ? path.resolve(process.env.WORK_ROOT, '..')
    : path.resolve(__dirname, '..');

  const db       = createDb(rootDir);
  const taskRow  = db.getTask(taskId);
  if (!taskRow) {
    console.error(`未找到任务: ${taskId}`);
    process.exit(1);
  }

  const stepsRows = db.getSteps(taskId);
  if (!stepsRows.length) {
    console.error(`任务 ${taskId} 没有步骤记录`);
    process.exit(1);
  }

  // T0: 最早的 started_at，或任务 created_at
  const t0Candidates = stepsRows
    .map(r => parseTs(r.started_at))
    .filter(Boolean);
  const t0 = t0Candidates.length
    ? Math.min(...t0Candidates)
    : (parseTs(taskRow.created_at) ?? Date.now());

  // 构建步骤列表（只保留有完整时间戳的步骤）
  const steps = stepsRows
    .filter(r => r.started_at && r.completed_at)
    .map(r => ({
      name:  r.step_name,
      cat:   STEP_CAT[r.step_name] || 'convert',
      start: parseTs(r.started_at)   - t0,
      end:   parseTs(r.completed_at) - t0,
    }))
    .filter(s => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  if (!steps.length) {
    console.error('没有可用的步骤时间戳，请确保任务已执行且步骤有 started_at / completed_at');
    process.exit(1);
  }

  const totalMs       = Math.max(...steps.map(s => s.end));
  const serialMs      = steps.reduce((sum, s) => sum + (s.end - s.start), 0);
  const maxConcurrent = Math.max(...steps.map((_, i, arr) => {
    const t = steps[i].start + 1;
    return arr.filter(s => t >= s.start && t < s.end).length;
  }));

  const mode     = taskRow.mode || 'media';
  const title    = taskRow.title || taskRow.url || taskId;
  const subtitle = `${taskId} &nbsp;·&nbsp; <code>mode=${mode}</code> &nbsp;·&nbsp; ${fmtDate(t0)}`;

  const data = {
    title:   title.length > 60 ? title.slice(0, 57) + '…' : title,
    subtitle,
    serialMs,
    scenarios: {
      [mode]: {
        label:         mode,
        totalMs,
        maxConcurrent,
        steps,
      }
    }
  };

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const html     = template.replace('__GANTT_DATA__', JSON.stringify(data));

  if (outArg) {
    fs.writeFileSync(outArg, html);
    console.error(`已生成: ${outArg}`);
  } else {
    process.stdout.write(html);
  }
}

main();
