// cli/lib/ensure-user-config.js
'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const os   = require('os');
const { USER_CONFIG_DIR, USER_CONFIG_PATH, DEFAULT_WORK_ROOT } = require('../../core/user-config');
const { writeWorkRoot } = require('../../core/paths');

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function detectExistingData(workRoot) {
  const workDir = path.join(workRoot, 'work');
  const dbPath  = path.join(workDir, 'database.sqlite');
  if (fs.existsSync(dbPath)) {
    let taskCount = 0;
    try {
      taskCount = fs.readdirSync(workDir)
        .filter(n => /^[0-9a-f]{12}$/.test(n)).length;
    } catch (_) {}
    return { found: true, hasDb: true, taskCount };
  }
  try {
    const taskFolders = fs.readdirSync(workDir)
      .filter(n => /^[0-9a-f]{12}$/.test(n));
    if (taskFolders.length > 0) return { found: true, hasDb: false, taskCount: taskFolders.length };
  } catch (_) {}
  return { found: false };
}

function promptLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function ensureUserConfig({
  configPath = USER_CONFIG_PATH,
  configDir  = USER_CONFIG_DIR,
} = {}) {
  if (fs.existsSync(configPath)) return;

  // Read template from installed scripts directory
  const examplePath = path.join(__dirname, '../../scripts/settings.example.conf');
  let exampleContent = '';
  try { exampleContent = fs.readFileSync(examplePath, 'utf8'); } catch (_) {}

  let workRootRaw = '~/vdl-work';
  let workRootAbs = DEFAULT_WORK_ROOT;

  if (process.stdin.isTTY) {
    const defaultDisplay = DEFAULT_WORK_ROOT.replace(os.homedir(), '~');
    process.stdout.write('\nWelcome to vdl! Setting up your config...\n');
    const ans = await promptLine(
      `Work root [${defaultDisplay}]:\n  (tasks will be stored under <work root>/work/)\n> `
    );
    if (ans) {
      workRootRaw = ans;
      workRootAbs = path.resolve(expandHome(ans));
    }

    const detection = detectExistingData(workRootAbs);
    process.stdout.write(`\nChecking ${path.join(workRootAbs, 'work')}/ ...\n`);
    if (detection.found && detection.hasDb) {
      const n = detection.taskCount;
      process.stdout.write(
        `✓ Found existing data (database.sqlite + ${n} task folder${n !== 1 ? 's' : ''}) — will be loaded automatically.\n`
      );
    } else if (detection.found) {
      process.stdout.write(`✓ Found existing task folders — will be loaded automatically.\n`);
    } else {
      process.stdout.write(`✓ New work directory will be created at ${path.join(workRootAbs, 'work')}/\n`);
    }
  }

  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, exampleContent, 'utf8');
  writeWorkRoot(configPath, workRootRaw);

  if (process.stdin.isTTY) {
    process.stdout.write(`\n✓ Config created: ${configPath}\n`);
    process.stdout.write(`✓ Data directory:  ${path.join(workRootAbs, 'work')}/\n\n`);
  }
}

module.exports = { ensureUserConfig };
