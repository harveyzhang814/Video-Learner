#!/usr/bin/env node
'use strict';
// Minimal HTTP server for CLI spawn tests.
// Responds to /healthz with 200. Writes/deletes token file.
const http = require('http');
const fs = require('fs');

const port = Number(process.env.PORT) || 3000;
const token = process.env.AGENT_EVENTS_TOKEN || '';
const tokenFile = process.env.CLI_TEST_TOKEN_FILE || '/tmp/vl-agent-token';

try { fs.writeFileSync(tokenFile, token); } catch {}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); res.end('ok'); }
  else { res.writeHead(404); res.end(); }
});

server.listen(port, '127.0.0.1', () => {
  // ready — parent will poll healthz
});

function cleanup() {
  try { fs.unlinkSync(tokenFile); } catch {}
}
process.on('exit', cleanup);
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
