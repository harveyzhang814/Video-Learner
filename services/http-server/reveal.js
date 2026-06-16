'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn: realSpawn } = require('node:child_process');

function pickOpener() {
  switch (process.platform) {
    case 'darwin': return 'open';
    case 'win32': return 'explorer';
    default: return 'xdg-open';
  }
}

function registerRevealRoute(router, { rootDir, host, spawn = realSpawn }) {
  router.post('/tasks/:taskId/reveal', async (ctx) => {
    if (host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      ctx.status = 403;
      ctx.body = { error: { code: 'NOT_LOOPBACK', message: 'reveal disabled when bound to non-loopback' } };
      return;
    }
    const { taskId } = ctx.params;
    const dir = path.join(rootDir, 'work', taskId);
    if (!fs.existsSync(dir)) {
      ctx.status = 404;
      ctx.body = { error: { code: 'NOT_FOUND', message: 'task folder not found' } };
      return;
    }
    const child = spawn(pickOpener(), [dir], { detached: true, stdio: 'ignore' });
    if (child && typeof child.unref === 'function') child.unref();
    ctx.status = 200;
    ctx.body = { ok: true };
  });
}

module.exports = { registerRevealRoute };
