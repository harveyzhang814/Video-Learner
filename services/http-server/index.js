'use strict';

const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const orchestrator = require('../../core/orchestrator');
const { EventStream } = require('./event-stream');

function createApp(options = {}) {
  const app = new Koa();
  const rootRouter = new Router();
  const router = new Router({
    prefix: '/api'
  });

  // Allow tests to inject rootDir (e.g. temp dir); default is worktree root
  const ROOT_DIR = options.rootDir ?? path.resolve(__dirname, '../..');
  const PKG_PATH = path.join(ROOT_DIR, 'package.json');
  const pkg = fs.existsSync(PKG_PATH) ? JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')) : { version: 'unknown' };

  const stream = options.eventStream ?? new EventStream({ maxBufferSize: options.maxEventBufferSize ?? 500 });
  const token = options.token ?? (process.env.AGENT_EVENTS_TOKEN || crypto.randomBytes(24).toString('hex'));

  // Bridge orchestrator events into global stream buffer.
  if (!options.disableOrchestratorBridge && typeof orchestrator.onEvent === 'function') {
    orchestrator.onEvent((ev) => {
      stream.append({ type: ev.type, taskId: ev.taskId, payload: ev.payload });
    });
  }

  rootRouter.get('/healthz', async (ctx) => {
    ctx.body = { ok: true };
  });

  rootRouter.get('/version', async (ctx) => {
    ctx.body = { version: pkg.version || 'unknown' };
  });

  router.get('/events', async (ctx) => {
    const qToken = (ctx.query && ctx.query.token) || '';
    if (!qToken || qToken !== token) {
      // Avoid logging full query string (contains token).
      ctx.status = 401;
      ctx.body = {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid token'
        }
      };
      return;
    }

    ctx.req.setTimeout(0);
    ctx.respond = false;
    const res = ctx.res;
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    };
    res.writeHead(200, headers);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    if (ctx.req.socket && typeof ctx.req.socket.setNoDelay === 'function') ctx.req.socket.setNoDelay(true);

    const write = (text) => {
      try {
        res.write(text);
      } catch (_) {
        // ignore
      }
    };

    // Initial comment to open stream promptly
    write(`: connected ${new Date().toISOString()}\n\n`);

    const lastEventId = ctx.get('Last-Event-Id');
    if (lastEventId) {
      const replay = stream.getReplaySince(lastEventId);
      if (!replay.ok) {
        const { minId, maxId } = replay;
        const data = JSON.stringify({
          type: 'stream.resync_required',
          ts: new Date().toISOString(),
          payload: {
            reason: replay.reason,
            minEventId: minId,
            maxEventId: maxId
          }
        }).replace(/\r?\n/g, '\\n');
        write(`id: 0\nevent: stream.resync_required\ndata: ${data}\n\n`);
      } else {
        for (const ev of replay.events) {
          write(EventStream.formatSseFrame(ev));
        }
      }
    }

    const unsubscribe = stream.onEvent((ev) => {
      write(EventStream.formatSseFrame(ev));
    });

    // Heartbeat every 15s (within 10-20s requirement)
    const heartbeat = setInterval(() => {
      write(': ping\n\n');
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      try {
        unsubscribe();
      } catch (_) {
        // ignore
      }
    };

    ctx.req.on('close', cleanup);
    ctx.req.on('error', cleanup);
  });

  router.post('/tasks', async (ctx) => {
  try {
    const { url, focus, mode, force, output_lang } = ctx.request.body || {};
    const task = await orchestrator.createTask({
      url,
      focus,
      mode,
      force,
      output_lang,
      rootDir: ROOT_DIR
    });

    // Fire-and-forget runTask; caller can poll status.
    orchestrator
      .runTask(task.task_id, { rootDir: ROOT_DIR })
      .catch((err) => console.error('runTask error', err));

    ctx.status = 201;
    ctx.body = task;
  } catch (err) {
    console.error('POST /api/tasks error', err);
    ctx.status = 400;
    ctx.body = { error: err.message || 'failed to create task' };
  }
  });

  router.get('/tasks', async (ctx) => {
    try {
      const limit = ctx.query && ctx.query.limit ? Number(ctx.query.limit) : 200;
      const rows = await orchestrator.listTasks({ rootDir: ROOT_DIR, limit });
      ctx.body = rows;
    } catch (err) {
      console.error('GET /api/tasks error', err);
      ctx.status = 500;
      ctx.body = { error: err.message || 'failed to list tasks' };
    }
  });

  router.get('/tasks/:taskId', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    ctx.body = task;
  } catch (err) {
    if (/task not found/.test(err.message)) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.body = { error: err.message || 'failed to get task' };
  }
  });

  router.delete('/tasks/:taskId', async (ctx) => {
    const { taskId } = ctx.params;
    const mode = (ctx.query.mode || (ctx.request.body && ctx.request.body.mode) || 'hard').toLowerCase();
    if (!['hard', 'state', 'soft'].includes(mode)) {
      ctx.status = 400;
      ctx.body = { error: 'invalid mode' };
      return;
    }
    try {
      await orchestrator.deleteTask(taskId, { rootDir: ROOT_DIR, mode });
      ctx.status = 204;
      ctx.body = null;
    } catch (err) {
      if (/task not found/.test(err.message)) {
        ctx.status = 404;
      } else {
        ctx.status = 500;
      }
      ctx.body = { error: err.message || 'delete failed' };
    }
  });

  router.get('/tasks/:taskId/result', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const result = await orchestrator.getTaskResult(taskId, { rootDir: ROOT_DIR });
    ctx.body = result;
  } catch (err) {
    if (/task not found/.test(err.message)) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.body = { error: err.message || 'failed to get task result' };
  }
  });

  router.get('/tasks/:taskId/media', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const result = await orchestrator.getTaskResult(taskId, { rootDir: ROOT_DIR });

    const taskIdInMeta = result && result.meta ? result.meta.id : undefined;
    if (!taskIdInMeta || typeof taskIdInMeta !== 'string') {
      ctx.status = 404;
      ctx.type = 'json';
      ctx.body = { error: 'task not found' };
      return;
    }

    const allowedPath = path.resolve(ROOT_DIR, 'work', taskIdInMeta, 'media', 'video.mp4');

    const outPath = result && result.outputs ? result.outputs.video_path : undefined;
    if (outPath && typeof outPath === 'string') {
      const resolved = path.resolve(path.isAbsolute(outPath) ? outPath : path.resolve(ROOT_DIR, outPath));
      const normalized = path.normalize(resolved);
      if (normalized !== allowedPath) {
        ctx.status = 404;
        ctx.type = 'json';
        ctx.body = { error: 'file not found', type: 'video' };
        return;
      }
    }

    ctx.status = 200;
    ctx.type = 'json';
    ctx.body = {
      video: {
        path: allowedPath,
        exists: fs.existsSync(allowedPath)
      }
    };
  } catch (err) {
    if (err && /task not found/.test(err.message || '')) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.type = 'json';
    ctx.body = { error: (err && err.message) || 'failed to get task media' };
  }
  });

  router.get('/tasks/:taskId/subtitles', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const result = await orchestrator.getTaskResult(taskId, { rootDir: ROOT_DIR });

    const taskIdInMeta = result && result.meta ? result.meta.id : undefined;
    if (!taskIdInMeta || typeof taskIdInMeta !== 'string') {
      ctx.status = 404;
      ctx.type = 'json';
      ctx.body = { error: 'task not found' };
      return;
    }

    const transcriptDir = path.resolve(ROOT_DIR, 'work', taskIdInMeta, 'transcript');
    const allowed = [
      { file: 'original_zh.vtt', id: 'original_zh', lang: 'zh', label: '中文' },
      { file: 'original_en.vtt', id: 'original_en', lang: 'en', label: 'English' }
    ];

    const tracks = [];
    for (const spec of allowed) {
      const candidates = [
        path.resolve(transcriptDir, spec.file),
        path.resolve(transcriptDir, 'subs', spec.file)
      ];

      for (const p of candidates) {
        const normalized = path.normalize(p);
        if (!normalized.startsWith(transcriptDir + path.sep)) continue;
        if (!fs.existsSync(normalized)) continue;

        const vtt = fs.readFileSync(normalized, 'utf8');
        tracks.push({ id: spec.id, lang: spec.lang, label: spec.label, vtt });
        break;
      }
    }

    ctx.status = 200;
    ctx.type = 'json';
    ctx.body = { tracks };
  } catch (err) {
    if (err && /task not found/.test(err.message || '')) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.type = 'json';
    ctx.body = { error: (err && err.message) || 'failed to get task subtitles' };
  }
  });

  router.get('/tasks/:taskId/result/content', async (ctx) => {
  const { taskId } = ctx.params;
  const type = (ctx.query && ctx.query.type) || '';
  if (type !== 'article' && type !== 'summary') {
    ctx.status = 400;
    ctx.type = 'json';
    ctx.body = { error: 'Missing or invalid query: type=article|summary' };
    return;
  }

  try {
    const result = await orchestrator.getTaskResult(taskId, { rootDir: ROOT_DIR });
    const pathKey = type === 'article' ? 'article_path' : 'summary_path';
    const outPath = result && result.outputs ? result.outputs[pathKey] : undefined;

    if (!outPath || typeof outPath !== 'string') {
      ctx.status = 404;
      ctx.type = 'json';
      ctx.body = { error: 'file not found', type };
      return;
    }

    const taskIdInMeta = result && result.meta ? result.meta.id : undefined;
    if (!taskIdInMeta || typeof taskIdInMeta !== 'string') {
      ctx.status = 404;
      ctx.type = 'json';
      ctx.body = { error: 'task not found' };
      return;
    }

    const writingDir = path.resolve(ROOT_DIR, 'work', taskIdInMeta, 'writing');
    const allowedPath = path.resolve(writingDir, type === 'article' ? 'article.md' : 'summary.md');

    const resolved = path.resolve(path.isAbsolute(outPath) ? outPath : path.resolve(ROOT_DIR, outPath));
    const normalized = path.normalize(resolved);

    if (normalized !== allowedPath) {
      ctx.status = 404;
      ctx.type = 'json';
      ctx.body = { error: 'file not found', type };
      return;
    }

    await fs.promises.access(normalized, fs.constants.R_OK);
    const content = await fs.promises.readFile(normalized, 'utf8');

    ctx.status = 200;
    ctx.set('Content-Type', 'text/markdown; charset=utf-8');
    ctx.body = content;
  } catch (err) {
    if (err && /task not found/.test(err.message || '')) {
      ctx.status = 404;
    } else if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.type = 'json';
    ctx.body = { error: (err && err.message) || 'failed to get content' };
  }
  });

  router.get('/tasks/:taskId/steps', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const steps = await orchestrator.getTaskSteps(taskId, { rootDir: ROOT_DIR });
    ctx.body = steps;
  } catch (err) {
    if (/task not found/.test(err.message)) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.body = { error: err.message || 'failed to get task steps' };
  }
  });

  router.post('/tasks/:taskId/steps/:stepName/run', async (ctx) => {
  const { taskId, stepName } = ctx.params;
  try {
    const { focus, force } = ctx.request.body || {};
    const result = await orchestrator.runStep(taskId, stepName, { focus, force, rootDir: ROOT_DIR });
    ctx.status = result.success ? 202 : 400;
    ctx.body = result;
  } catch (err) {
    if (/task not found/.test(err.message) || /unknown step/.test(err.message)) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.body = { error: err.message || 'failed to run step' };
  }
  });

  app.use(bodyParser());
  app.use(rootRouter.routes());
  app.use(rootRouter.allowedMethods());
  app.use(router.routes());
  app.use(router.allowedMethods());

  // Expose token for callers/tests (do not include in logs elsewhere).
  app.context.eventsToken = token;

  return app;
}

// When required as a module, export factory for tests.
module.exports = { createApp };

// When run directly (npm run agent:serve), start the server.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  const app = createApp();
  app.listen(port, () => {
    console.log(`Agent HTTP service listening on http://localhost:${port}`);
    // IMPORTANT: never log the SSE token.
  });
}

