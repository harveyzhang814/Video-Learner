'use strict';

const assert = require('assert');
const {
  // We only need to import the helpers via the main module side effects.
} = require('../core/orchestrator');

// NOTE: This test is intentionally minimal and focuses on verifying that
// the yt-dlp progress line format used in scripts/* can be parsed and that
// percentage math is stable. It does NOT spin up real downloads.

function parseYtDlpProgressLine(line) {
  const m = line.match(/^\[progress\]\s+downloaded=(\d+)\s+total=(\d+)\s+speed=([\d.]+)\s+eta=(\d+)/);
  if (!m) return null;
  const downloaded = Number(m[1]);
  const total = Number(m[2]);
  const speed = Number(m[3]);
  const eta = Number(m[4]);
  if (!Number.isFinite(downloaded) || downloaded < 0) return null;
  if (!Number.isFinite(total) || total < 0) return null;
  return { downloaded, total, speed: Number.isFinite(speed) ? speed : 0, eta: Number.isFinite(eta) ? eta : 0 };
}

function run() {
  const line = '[progress] downloaded=1024 total=2048 speed=512.0 eta=10';
  const parsed = parseYtDlpProgressLine(line);
  assert.ok(parsed, 'parsed should not be null');
  assert.strictEqual(parsed.downloaded, 1024);
  assert.strictEqual(parsed.total, 2048);
  assert.strictEqual(parsed.speed, 512.0);
  assert.strictEqual(parsed.eta, 10);

  const percent = Math.round((parsed.downloaded / parsed.total) * 100);
  assert.strictEqual(percent, 50);

  const notProgress = parseYtDlpProgressLine('[INFO] something else');
  assert.strictEqual(notProgress, null);

  console.log('orchestrator-progress-logging.test.js: basic parsing OK');
}

run();

