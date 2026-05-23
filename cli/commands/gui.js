// cli/commands/gui.js
'use strict';
const { spawn } = require('child_process');
const path = require('path');

async function run() {
  const script = path.resolve(__dirname, '../../start-electron.sh');
  const child = spawn('bash', [script], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  process.stdout.write('GUI launched.\n');
}

module.exports = { run };
