'use strict';

const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const path = require('path');

const orchestrator = require('../../core/orchestrator');

function createApp(options = {}) {
  const app = new Koa();
  const router = new Router({
    prefix: '/api'
  });

  // Allow tests to inject rootDir (e.g. temp dir); default is worktree root
  const ROOT_DIR = options.rootDir ?? path.resolve(__dirname, '../..');

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
      .runTask(task.task_id)
      .catch((err) => console.error('runTask error', err));

    ctx.status = 201;
    ctx.body = task;
  } catch (err) {
    console.error('POST /api/tasks error', err);
    ctx.status = 400;
    ctx.body = { error: err.message || 'failed to create task' };
  }
  });

  router.get('/tasks/:taskId', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const task = await orchestrator.getTask(taskId);
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

  router.get('/tasks/:taskId/result', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const result = await orchestrator.getTaskResult(taskId);
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

  router.get('/tasks/:taskId/steps', async (ctx) => {
  const { taskId } = ctx.params;
  try {
    const steps = await orchestrator.getTaskSteps(taskId);
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
    const result = await orchestrator.runStep(taskId, stepName, { focus, force });
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
  app.use(router.routes());
  app.use(router.allowedMethods());

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
  });
}

