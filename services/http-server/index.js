'use strict';

const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const orchestrator = require('../../core/orchestrator');
const { getTaskDirs, getWorkRoot, resolveWorkBase, writeWorkRoot } = require('../../core/paths');
const { EventStream } = require('./event-stream');
const { migrateModeName } = require('../../scripts/migrate-mode-names');
const { createStaticServe } = require('./static-serve');
const { registerRevealRoute } = require('./reveal');

function createApp(options = {}) {
  const app = new Koa();
  const rootRouter = new Router();
  const router = new Router({
    prefix: '/api'
  });

  // Allow tests to inject rootDir (e.g. temp dir); default is worktree root
  const ROOT_DIR = options.rootDir ?? path.resolve(__dirname, '../..');
  const HOST = options.host ?? '127.0.0.1';
  // Run once on startup — idempotent, no-op if DB doesn't exist yet.
  migrateModeName(getWorkRoot(ROOT_DIR));
  const PKG_PATH = path.join(ROOT_DIR, 'package.json');
  const pkg = fs.existsSync(PKG_PATH) ? JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')) : { version: 'unknown' };

  const stream = options.eventStream ?? new EventStream({ maxBufferSize: options.maxEventBufferSize ?? 500 });
  const token = options.token ?? (process.env.AGENT_EVENTS_TOKEN || crypto.randomBytes(24).toString('hex'));

  // --- Heartbeat registry ---
  // clientId → lastSeen timestamp (ms). Used for auto-shutdown.
  const heartbeatRegistry = new Map();

  // --- SSE connection registry ---
  // Active SSE connection ids. Browser tabs are tracked via this set;
  // the existing heartbeatRegistry continues to track CLI/API clients.
  const sseRegistry = new Set();

  /** Optional test hook: replace fire-and-forget runTask after reset_scope downstream (default: real orchestrator.runTask). */
  const runTaskForDownstream =
    typeof options.runTaskForDownstream === 'function'
      ? options.runTaskForDownstream
      : (tid, o) => orchestrator.runTask(tid, o);

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

  // Bearer token auth for all /api/* routes except /api/events and media streams (those handle auth internally).
  router.use(async (ctx, next) => {
    if (ctx.path === '/api/events') return next();
    if (/\/tasks\/[^/]+\/media\//.test(ctx.path)) return next();
    const authHeader = ctx.get('Authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!bearer || bearer !== token) {
      ctx.status = 401;
      ctx.body = { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } };
      return;
    }
    return next();
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

    const sseId = crypto.randomUUID();
    sseRegistry.add(sseId);

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
      sseRegistry.delete(sseId);
    };

    ctx.req.on('close', cleanup);
    ctx.req.on('error', cleanup);
  });

  router.get('/config', async (ctx) => {
    const settingsPath = path.join(ROOT_DIR, 'scripts', 'settings.conf');
    const workRoot = resolveWorkBase(ROOT_DIR);
    const isDefault = workRoot === path.resolve(ROOT_DIR);
    ctx.body = {
      workRoot: isDefault ? null : workRoot,
      workDir: path.join(workRoot, 'work'),
      settingsPath,
    };
  });

  router.post('/config', async (ctx) => {
    const { workRoot } = ctx.request.body || {};
    if (!workRoot || typeof workRoot !== 'string' || !workRoot.trim()) {
      ctx.status = 400;
      ctx.body = { error: 'workRoot is required' };
      return;
    }
    const raw = workRoot.trim();
    if (!raw.startsWith('/') && !raw.startsWith('~')) {
      ctx.status = 400;
      ctx.body = { error: 'workRoot must be an absolute path or start with ~' };
      return;
    }
    const settingsPath = path.join(ROOT_DIR, 'scripts', 'settings.conf');
    writeWorkRoot(settingsPath, raw);
    ctx.body = { ok: true, workRoot: raw, restart_required: true };
  });

  router.post('/tasks', async (ctx) => {
  try {
    const { url, focus, mode, force, output_lang, timeout_scale } = ctx.request.body || {};
    const task = await orchestrator.createTask({
      url,
      focus,
      mode,
      force,
      output_lang,
      timeout_scale,
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

  router.get('/tasks/:taskId/paths', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    // Ensure task exists and load meta so we can use the canonical id.
    const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
    const metaId = task && task.meta && typeof task.meta.id === 'string' ? task.meta.id : taskId;
    const dirs = getTaskDirs(ROOT_DIR, metaId);

    ctx.status = 200;
    ctx.type = 'json';
    ctx.body = {
      id: metaId,
      base: dirs.base,
      media: dirs.media,
      transcript: dirs.transcript,
      writing: dirs.writing
    };
  } catch (err) {
    if (/task not found/.test(err.message || '')) {
      ctx.status = 404;
    } else {
      ctx.status = 500;
    }
    ctx.type = 'json';
    ctx.body = { error: err.message || 'failed to get task paths' };
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
      } else if (err.code === 'TASK_OR_STEP_RUNNING') {
        ctx.status = 409;
      } else {
        ctx.status = 500;
      }
      ctx.body = { error: err.message || 'delete failed' };
    }
  });

  router.post('/tasks/:taskId/cancel', async (ctx) => {
    const { taskId } = ctx.params;
    try {
      const result = await orchestrator.abortTask(taskId, { rootDir: ROOT_DIR });
      ctx.status = 200;
      ctx.body = result;
    } catch (err) {
      if (/task not found/.test(err.message)) {
        ctx.status = 404;
        ctx.body = { error: err.message };
      } else if (err.code === 'NOT_RUNNING') {
        ctx.status = 409;
        ctx.body = { error: err.message, code: err.code };
      } else {
        ctx.status = 500;
        ctx.body = { error: err.message || 'cancel failed' };
      }
    }
  });

  router.post('/tasks/:taskId/resume', async (ctx) => {
    const { taskId } = ctx.params;
    try {
      const result = await orchestrator.resumeTask(taskId, { rootDir: ROOT_DIR });
      ctx.status = 202;
      ctx.body = result; // { task_id, status: 'running' }
    } catch (err) {
      if (/task not found/.test(err.message)) {
        ctx.status = 404;
        ctx.body = { error: err.message };
      } else if (err.code === 'NOT_ABORTED') {
        ctx.status = 409;
        ctx.body = { error: err.message, code: 'NOT_ABORTED' };
      } else {
        ctx.status = 500;
        ctx.body = { error: err.message || 'resume failed' };
      }
    }
  });

  router.post('/tasks/:taskId/steps/:stepName/cancel', async (ctx) => {
    const { taskId, stepName } = ctx.params;
    try {
      const result = await orchestrator.abortStep(taskId, stepName, { rootDir: ROOT_DIR });
      ctx.status = 200;
      ctx.body = result;
    } catch (err) {
      if (/task not found/.test(err.message) || err.code === 'BAD_STEP') {
        ctx.status = 404;
        ctx.body = { error: err.message };
      } else if (err.code === 'STEP_NOT_RUNNING' || err.code === 'STEP_ABORT_IN_PROGRESS') {
        ctx.status = 409;
        ctx.body = { error: err.message, code: err.code };
      } else {
        ctx.status = 500;
        ctx.body = { error: err.message || 'cancel step failed' };
      }
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

    const videoAllowedPath = path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'media', 'video.mp4');
    const audioAllowedPath = path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'media', 'audio.m4a');

    const outPath = result && result.outputs ? result.outputs.video_path : undefined;
    if (outPath && typeof outPath === 'string') {
      const resolved = path.resolve(path.isAbsolute(outPath) ? outPath : path.resolve(ROOT_DIR, outPath));
      const normalized = path.normalize(resolved);
      if (normalized !== videoAllowedPath) {
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
        path: videoAllowedPath,
        exists: fs.existsSync(videoAllowedPath)
      },
      audio: {
        path: audioAllowedPath,
        exists: fs.existsSync(audioAllowedPath)
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

  // Stream the actual video/audio file with HTTP Range support
  router.get('/tasks/:taskId/media/:kind', async (ctx) => {
    const { taskId, kind } = ctx.params;
    if (kind !== 'video' && kind !== 'audio') { ctx.status = 400; return; }
    // Accept token via query param (browser <video src> cannot set headers)
    const authHeader = ctx.get('Authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const qToken = String((ctx.query && ctx.query.token) || '');
    if (bearer !== token && qToken !== token) {
      ctx.status = 401;
      ctx.body = { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } };
      return;
    }
    try {
      const result = await orchestrator.getTaskResult(taskId, { rootDir: ROOT_DIR });
      const taskIdInMeta = result && result.meta ? result.meta.id : undefined;
      if (!taskIdInMeta) { ctx.status = 404; ctx.body = { error: 'task not found' }; return; }

      const filename = kind === 'video' ? 'video.mp4' : 'audio.m4a';
      const filePath = path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'media', filename);
      if (!fs.existsSync(filePath)) { ctx.status = 404; ctx.body = { error: 'file not found' }; return; }

      const stat = fs.statSync(filePath);
      const total = stat.size;
      const mimeType = kind === 'video' ? 'video/mp4' : 'audio/mp4';
      const rangeHeader = ctx.get('Range');

      if (rangeHeader) {
        const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(startStr, 10);
        const end = endStr ? parseInt(endStr, 10) : Math.min(start + 1024 * 1024, total - 1);
        ctx.status = 206;
        ctx.set('Content-Range', `bytes ${start}-${end}/${total}`);
        ctx.set('Accept-Ranges', 'bytes');
        ctx.set('Content-Length', String(end - start + 1));
        ctx.type = mimeType;
        ctx.body = fs.createReadStream(filePath, { start, end });
      } else {
        ctx.set('Accept-Ranges', 'bytes');
        ctx.set('Content-Length', String(total));
        ctx.type = mimeType;
        ctx.body = fs.createReadStream(filePath);
      }
    } catch (err) {
      ctx.status = 500;
      ctx.body = { error: (err && err.message) || 'stream error' };
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

    const transcriptDir = path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'transcript');
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

  // ── Notes helpers ──────────────────────────────────────────────────────────
  async function readNotes(notesPath) {
    try {
      const raw = await fs.promises.readFile(notesPath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  async function writeNotes(notesPath, notes) {
    const tmp = notesPath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(notes, null, 2), 'utf8');
    await fs.promises.rename(tmp, notesPath);
  }

  router.get('/tasks/:taskId/notes', async (ctx) => {
    const { taskId } = ctx.params;
    try {
      const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
      const metaId = task?.meta?.id ?? taskId;
      const { notes: notesPath } = getTaskDirs(ROOT_DIR, metaId);
      const notes = await readNotes(notesPath);
      ctx.body = notes;
    } catch (err) {
      if (/task not found/.test(err.message || '')) { ctx.status = 404; }
      else { ctx.status = 500; }
      ctx.body = { error: err.message || 'failed to get notes' };
    }
  });

  router.post('/tasks/:taskId/notes', async (ctx) => {
    const { taskId } = ctx.params;
    const { anchor = '', mediaTimestamp, body } = ctx.request.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) {
      ctx.status = 400;
      ctx.body = { error: 'body is required' };
      return;
    }
    try {
      const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
      const metaId = task?.meta?.id ?? taskId;
      const { notes: notesPath } = getTaskDirs(ROOT_DIR, metaId);
      const notes = await readNotes(notesPath);
      const now = Date.now();
      const note = {
        id: crypto.randomUUID(),
        anchor: anchor || '',
        ...(mediaTimestamp != null ? { mediaTimestamp: Number(mediaTimestamp) } : {}),
        body: body.trim(),
        createdAt: now,
        updatedAt: now,
      };
      notes.unshift(note);
      await writeNotes(notesPath, notes);
      ctx.status = 201;
      ctx.body = note;
    } catch (err) {
      if (/task not found/.test(err.message || '')) { ctx.status = 404; }
      else { ctx.status = 500; }
      ctx.body = { error: err.message || 'failed to create note' };
    }
  });

  router.patch('/tasks/:taskId/notes/:noteId', async (ctx) => {
    const { taskId, noteId } = ctx.params;
    const { body } = ctx.request.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) {
      ctx.status = 400;
      ctx.body = { error: 'body is required' };
      return;
    }
    try {
      const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
      const metaId = task?.meta?.id ?? taskId;
      const { notes: notesPath } = getTaskDirs(ROOT_DIR, metaId);
      const notes = await readNotes(notesPath);
      const idx = notes.findIndex((n) => n.id === noteId);
      if (idx === -1) { ctx.status = 404; ctx.body = { error: 'note not found' }; return; }
      notes[idx] = { ...notes[idx], body: body.trim(), updatedAt: Date.now() };
      await writeNotes(notesPath, notes);
      ctx.body = notes[idx];
    } catch (err) {
      if (/task not found/.test(err.message || '')) { ctx.status = 404; }
      else { ctx.status = 500; }
      ctx.body = { error: err.message || 'failed to update note' };
    }
  });

  router.delete('/tasks/:taskId/notes/:noteId', async (ctx) => {
    const { taskId, noteId } = ctx.params;
    try {
      const task = await orchestrator.getTask(taskId, { rootDir: ROOT_DIR });
      const metaId = task?.meta?.id ?? taskId;
      const { notes: notesPath } = getTaskDirs(ROOT_DIR, metaId);
      const notes = await readNotes(notesPath);
      const filtered = notes.filter((n) => n.id !== noteId);
      if (filtered.length === notes.length) {
        ctx.status = 404; ctx.body = { error: 'note not found' }; return;
      }
      await writeNotes(notesPath, filtered);
      ctx.status = 204;
    } catch (err) {
      if (/task not found/.test(err.message || '')) { ctx.status = 404; }
      else { ctx.status = 500; }
      ctx.body = { error: err.message || 'failed to delete note' };
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

    const writingDir = path.join(getWorkRoot(ROOT_DIR), taskIdInMeta, 'writing');
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
      const body = ctx.request.body || {};
      const { focus, force, reset_scope: resetScopeRaw } = body;
      const resetScope =
        resetScopeRaw == null || resetScopeRaw === '' ? 'off' : String(resetScopeRaw);

      if (!['off', 'step', 'downstream'].includes(resetScope)) {
        ctx.status = 400;
        ctx.body = { error: 'reset_scope must be off, step, or downstream' };
        return;
      }

      const opts = { focus, force, rootDir: ROOT_DIR };

      if (resetScope === 'off') {
        const result = await orchestrator.runStep(taskId, stepName, opts);
        ctx.status = result.success ? 202 : 400;
        ctx.body = result;
        return;
      }

      let applied;
      try {
        applied = orchestrator.applyResetScope(taskId, stepName, resetScope, { rootDir: ROOT_DIR });
      } catch (e) {
        if (e.code === 'TASK_OR_STEP_RUNNING') {
          ctx.status = 409;
          ctx.body = { error: e.message, code: e.code };
          return;
        }
        if (e.code === 'BAD_ANCHOR_MODE' || e.code === 'ANCHOR_SKIPPED') {
          ctx.status = 400;
          ctx.body = { error: e.message, code: e.code };
          return;
        }
        if (e.code === 'BAD_STEP' || /unknown step/.test(e.message || '')) {
          ctx.status = 404;
          ctx.body = { error: e.message || 'unknown step' };
          return;
        }
        throw e;
      }

      if (resetScope === 'downstream') {
        Promise.resolve(runTaskForDownstream(taskId, { rootDir: ROOT_DIR })).catch((err) =>
          console.error('runTask error', err)
        );
        ctx.status = 202;
        ctx.body = {
          accepted: true,
          task_id: taskId,
          from_step: stepName,
          reset_scope: 'downstream',
          reset_steps: applied.reset_steps
        };
        return;
      }

      const result = await orchestrator.runStep(taskId, stepName, opts);
      ctx.status = result.success ? 202 : 400;
      ctx.body = { ...result, reset_steps: applied.reset_steps };
    } catch (err) {
      if (/task not found/.test(err.message) || /unknown step/.test(err.message)) {
        ctx.status = 404;
      } else {
        ctx.status = 500;
      }
      ctx.body = { error: err.message || 'failed to run step' };
    }
  });

  // POST /api/heartbeat  { clientId } — register/refresh a client
  router.post('/heartbeat', async (ctx) => {
    const { clientId } = ctx.request.body || {};
    if (typeof clientId !== 'string' || !clientId.trim()) {
      ctx.status = 400;
      ctx.body = { error: 'clientId required' };
      return;
    }
    heartbeatRegistry.set(clientId, Date.now());
    ctx.body = { ok: true };
  });

  // GET /api/heartbeat/status — diagnostic (static path before parameterized)
  router.get('/heartbeat/status', async (ctx) => {
    ctx.body = { clientCount: heartbeatRegistry.size, clients: [...heartbeatRegistry.keys()] };
  });

  // DELETE /api/heartbeat/:clientId — explicit deregister
  router.delete('/heartbeat/:clientId', async (ctx) => {
    heartbeatRegistry.delete(ctx.params.clientId);
    ctx.body = { ok: true };
  });

  registerRevealRoute(router, { rootDir: ROOT_DIR, host: HOST, spawn: options.spawn });

  // SPA static serve (must come before /api routes to claim "/")
  app.use(createStaticServe({ rootDir: ROOT_DIR, token }));

  app.use(bodyParser());
  app.use(rootRouter.routes());
  app.use(rootRouter.allowedMethods());
  app.use(router.routes());
  app.use(router.allowedMethods());

  // Expose token for callers/tests (do not include in logs elsewhere).
  app.context.eventsToken = token;
  app.context.heartbeatRegistry = heartbeatRegistry;
  app.context.sseRegistry = sseRegistry;

  return app;
}

// When required as a module, export factory for tests.
module.exports = { createApp };

// When run directly (npm run agent:serve), start the server.
if (require.main === module) {
  const port     = Number(process.env.PORT)      || 3000;
  const host     = process.env.HOST              || '127.0.0.1';
  const TOKEN_FILE = process.env.TOKEN_FILE      || '/tmp/vl-agent-token';
  const PID_FILE   = process.env.PID_FILE        || '/tmp/vl-agent.pid';

  const app   = createApp();
  const token = app.context.eventsToken;

  const rootDir = path.resolve(__dirname, '../..');

  // Track whether this process successfully wrote discovery files.
  // Only clean them up if WE wrote them (prevents EADDRINUSE loser from
  // deleting the winner's token/PID files).
  let discoveryFilesWritten = false;

  let cleanedUp = false;
  let graceTimer = null;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (discoveryFilesWritten) {
      try { fs.unlinkSync(TOKEN_FILE); } catch (_) {}
      try { fs.unlinkSync(PID_FILE);   } catch (_) {}
    }
  }
  process.on('exit',   cleanup);
  process.on('SIGINT',  () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // Auto-shutdown (only when AUTO_SHUTDOWN=1)
  if (process.env.AUTO_SHUTDOWN === '1') {
    const EVICT_MS    = Number(process.env.AUTO_SHUTDOWN_EVICT_MS)    || 20000;
    const GRACE_MS    = Number(process.env.AUTO_SHUTDOWN_GRACE_MS)    || 30000;
    const INTERVAL_MS = Number(process.env.AUTO_SHUTDOWN_INTERVAL_MS) || 5000;

    let gracePending = false;

    const shutdownInterval = setInterval(() => {
      const registry = app.context.heartbeatRegistry;
      if (!registry) return;

      const now = Date.now();
      // Evict stale clients
      for (const [id, lastSeen] of registry.entries()) {
        if (now - lastSeen > EVICT_MS) registry.delete(id);
      }

      const sseReg = app.context.sseRegistry;
      const hasClients = registry.size > 0 || (sseReg && sseReg.size > 0);

      // Check for running tasks via in-memory counter (listTasks queries the DB
      // which does not include a live status field — activeRunTasks is authoritative).
      const hasRunningTasks = orchestrator.getActiveTaskCount() > 0;

      if (!hasClients && !hasRunningTasks) {
        if (!gracePending) {
          gracePending = true;
          graceTimer = setTimeout(() => {
            cleanup();
            process.exit(0);
          }, GRACE_MS);
        }
      } else {
        // Cancel pending grace if a new client registered or tasks started
        if (gracePending) {
          clearTimeout(graceTimer);
          graceTimer   = null;
          gracePending = false;
        }
      }
    }, INTERVAL_MS);
    shutdownInterval.unref();
  }

  const server = app.listen(port, host, () => {
    // Write discovery files only after successful bind — prevents EADDRINUSE
    // loser from overwriting/deleting the winner's token and PID files.
    try { fs.writeFileSync(TOKEN_FILE, token); }   catch (_) {}
    try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (_) {}
    discoveryFilesWritten = true;

    // Reset any steps left in 'running' state from a previous crash/restart.
    try {
      const { createDb } = require('../../core/orchestrator/db');
      const db = createDb(rootDir);
      const reset = db.resetStaleRunningSteps();
      if (reset > 0) console.log(`[agent-http] Reset ${reset} stale running step(s) from previous session`);
      db.close();
    } catch (e) {
      console.error('[agent-http] Failed to reset stale steps:', e && e.message);
    }

    console.log(`Agent HTTP service listening on http://${host}:${port}`);
    // IMPORTANT: never log the SSE token.
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[agent-http] Port ${port} already in use — another instance may be running.`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}

