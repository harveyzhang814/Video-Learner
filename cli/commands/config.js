'use strict';

const path = require('path');
const { writeWorkRoot, resolveWorkBase, getWorkRoot } = require('../../core/paths');

const ROOT_DIR = path.resolve(__dirname, '../..');
const SETTINGS_PATH = path.join(ROOT_DIR, 'scripts', 'settings.conf');

async function run(args) {
  const [action, key, value] = args;

  if (action === 'get') {
    const workRoot = resolveWorkBase(ROOT_DIR);
    const isDefault = workRoot === ROOT_DIR;
    process.stdout.write(`workRoot: ${isDefault ? '(default)' : workRoot}\n`);
    process.stdout.write(`workDir:  ${getWorkRoot(ROOT_DIR)}\n`);
    return;
  }

  if (action === 'set') {
    if (key !== 'work-root') {
      process.stderr.write(`Unknown config key: ${key}\nSupported keys: work-root\n`);
      process.exit(1);
    }
    if (!value) {
      process.stderr.write('Usage: vdl config set work-root <path>\n');
      process.exit(1);
    }
    if (!value.startsWith('/') && !value.startsWith('~')) {
      process.stderr.write('Error: work-root must be an absolute path or start with ~\n');
      process.exit(1);
    }
    writeWorkRoot(SETTINGS_PATH, value);
    process.stdout.write(`work-root set to: ${value}\n`);
    process.stdout.write(`Settings saved to: ${SETTINGS_PATH}\n`);
    process.stdout.write(`Restart the backend for changes to take effect.\n`);
    return;
  }

  process.stderr.write('Usage:\n  vdl config get\n  vdl config set work-root <path>\n');
  process.exit(1);
}

module.exports = { run };
