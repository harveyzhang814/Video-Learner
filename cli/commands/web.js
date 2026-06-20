// cli/commands/web.js
'use strict';
const { spawn } = require('child_process');
const { connect } = require('../../core/agent-connect');

function parseArgs(argv) {
  const out = { port: 3000, openBrowser: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-browser') out.openBrowser = false;
    else if (a === '--port') out.port = Number(argv[++i]);
  }
  if (!Number.isInteger(out.port) || out.port <= 0) {
    throw new Error(`invalid --port value: ${out.port}`);
  }
  return out;
}

function openInBrowser(url) {
  const platform = process.platform;
  let cmd, args;
  if (platform === 'darwin')      { cmd = 'open';     args = [url]; }
  else if (platform === 'win32')  { cmd = 'cmd';      args = ['/c', 'start', '', url]; }
  else                            { cmd = 'xdg-open'; args = [url]; }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {
    process.stderr.write(`(unable to open browser; visit ${url} manually)\n`);
  });
  child.unref();
}

async function run(argv = []) {
  const { port, openBrowser } = parseArgs(argv);
  const baseUrl = `http://127.0.0.1:${port}`;

  await connect({ baseUrl, noHeartbeat: true });

  if (openBrowser) {
    openInBrowser(baseUrl);
  }

  process.stdout.write(`Backend running on ${baseUrl}\n`);
  process.stdout.write(`Close the browser tab when done — backend will shut down automatically.\n`);
  process.exit(0);
}

module.exports = { run };
