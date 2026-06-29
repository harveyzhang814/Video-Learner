'use strict';

const STEP_DISPLAY = {
  fetch:   'fetch_info',
  subs:    'download_subs',
  vtt2md:  'convert_vtt_md',
  article: 'generate_article',
  summary: 'generate_summary',
  video:   'download_video',
  audio:   'download_audio',
  asr:     'asr_transcribe',
  md2vtt:  'convert_md_vtt',
};

function displayName(step) {
  return STEP_DISPLAY[step] || step;
}

function statusIcon(status) {
  switch (status) {
    case 'done':    return '✓';
    case 'running': return '⠸';
    case 'failed':  return '✗';
    case 'skipped': return '–';
    default:        return ' ';
  }
}

const isTTY = Boolean(process.stdout.isTTY);

function buildProgressLines(title, steps) {
  const bar = '─'.repeat(50);
  const lines = [`Processing: ${title}`, bar];
  for (const [name, info] of Object.entries(steps || {})) {
    if (!info) continue;
    const icon = statusIcon(info.status);
    const label = displayName(name).padEnd(22);
    let extra = '';
    if (info.status === 'running') extra = 'running...';
    else if (info.elapsed) extra = `${info.elapsed}s`;
    lines.push(`${icon} ${label} ${extra}`);
  }
  return lines;
}

let _lastLineCount = 0;

function renderProgress(title, steps) {
  if (!isTTY) return;
  if (_lastLineCount > 0) {
    process.stdout.write(`\x1b[${_lastLineCount}A\x1b[0J`);
  }
  const lines = buildProgressLines(title, steps);
  process.stdout.write(lines.join('\n') + '\n');
  _lastLineCount = lines.length;
}

function logStepLine(stepName, status, elapsedS) {
  const elapsed = elapsedS != null ? ` (${elapsedS}s)` : '';
  process.stdout.write(`[${displayName(stepName)}] ${status}${elapsed}\n`);
}

function logProgressLine(stepName, progress, elapsedS) {
  const elapsed = elapsedS != null ? ` (${elapsedS}s)` : '';
  const parts = [];
  if (progress.percent != null) parts.push(`${progress.percent}%`);
  if (progress.speed)           parts.push(progress.speed);
  if (progress.eta)             parts.push(`eta ${progress.eta}`);
  if (progress.step)            parts.push(`step ${progress.step}`);
  if (progress.label)           parts.push(progress.label);
  if (progress.segments)        parts.push(`${progress.segments} segments`);
  process.stdout.write(`[${displayName(stepName)}] running${elapsed} — ${parts.join(' ')}\n`);
}

function printDone(elapsed, paths) {
  if (isTTY) process.stdout.write('\n');
  process.stdout.write(`Done in ${elapsed}s\n\n`);
  for (const [label, p] of Object.entries(paths)) {
    if (p) process.stdout.write(`  ${label.padEnd(12)} ${p}\n`);
  }
  process.stdout.write('\n');
}

function printError(msg) {
  process.stderr.write(`\x1b[31mError:\x1b[0m ${msg}\n`);
}

function printInterrupted(taskId) {
  process.stderr.write(
    `\n^C  Interrupted. Task ${taskId} may have a step stuck in 'running'.\n` +
    `    To resume: vdl rerun ${taskId} <step> --reset step\n`
  );
}

module.exports = {
  displayName, statusIcon, isTTY,
  buildProgressLines, renderProgress, logStepLine, logProgressLine,
  printDone, printError, printInterrupted,
};
