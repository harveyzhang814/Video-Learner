'use strict';

/**
 * 自动测试：仅执行 fetch 步骤（直接调用 scripts/fetch_info.sh），确保能拉取视频元信息并通过断言。
 * 依赖：yt-dlp、jq、sqlite3、scripts；若遇 YouTube 人机验证需配置 scripts/settings.conf（YT_DLP_COOKIES_BROWSER）。
 * 不依赖 Electron/better-sqlite3，可用系统 Node 直接运行。
 */

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { generateId } = require('../core/id');

const ROOT_DIR = path.resolve(__dirname, '..');
const TEST_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function runScript(scriptName, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const script = path.join(ROOT_DIR, 'scripts', scriptName);
    const proc = spawn('bash', [script, ...args], {
      cwd: ROOT_DIR,
      env: { ...process.env, PATH: [process.env.PATH, '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean).join(':') }
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
  });
}

async function run() {
  console.log('[fetch-step.test] ROOT_DIR:', ROOT_DIR);
  console.log('[fetch-step.test] URL:', TEST_URL);

  const id = generateId(TEST_URL);
  const workDir = path.join(ROOT_DIR, 'work', id);
  fs.mkdirSync(path.join(workDir, 'transcript'), { recursive: true });
  fs.mkdirSync(path.join(workDir, 'media'), { recursive: true });
  fs.mkdirSync(path.join(workDir, 'writing'), { recursive: true });
  console.log('[fetch-step.test] task id:', id, 'workDir:', workDir);

  const result = await runScript('fetch_info.sh', [TEST_URL, workDir, id]);

  if (result.code !== 0) {
    console.error('[fetch-step.test] stdout:', result.stdout);
    console.error('[fetch-step.test] stderr:', result.stderr);
    throw new Error(`fetch_info.sh exited with code ${result.code}`);
  }

  if (!result.stdout.includes('[STATUS] fetch_done')) {
    throw new Error('fetch_info.sh did not print [STATUS] fetch_done');
  }

  const dbPath = path.join(ROOT_DIR, 'work', 'database.sqlite');
  if (fs.existsSync(dbPath)) {
    const { execSync } = require('child_process');
    const titleRow = execSync(`sqlite3 "${dbPath}" "SELECT title FROM tasks WHERE id='${id}';"`, { encoding: 'utf8' }).trim();
    if (!titleRow || titleRow === 'Untitled') {
      console.warn('[fetch-step.test] DB title empty or Untitled');
    } else {
      console.log('[fetch-step.test] DB title:', titleRow);
    }
  }

  console.log('[fetch-step.test] PASS');
}

run().catch((err) => {
  console.error('[fetch-step.test] FAIL:', err.message);
  process.exit(1);
});
