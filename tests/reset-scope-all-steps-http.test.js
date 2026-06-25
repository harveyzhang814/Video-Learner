'use strict';

/**
 * Agent HTTP: reset_scope `step` and `downstream` for every DAG step × mode matrix.
 * Downstream uses createApp({ runTaskForDownstream: noop }) so tests do not spawn the real pipeline.
 * Media/fetch/subs + reset_scope step use a short-lived runStep stub so yt-dlp is never invoked.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../services/http-server');
const { createDb } = require('../core/orchestrator/db');
const orchestrator = require('../core/orchestrator');
const { ALL_STEPS, excludedByMode, getDownstreamClosure } = require('../core/orchestrator/schedule');

const MODES = ['transcript', 'media', 'audio', 'full'];

let runStepSeq = 0;

function sortNames(arr) {
  return [...(arr || [])].sort();
}

function sameStepSet(a, b) {
  assert.deepStrictEqual(sortNames(a), sortNames(b), `expected reset_steps ${sortNames(b)}, got ${sortNames(a)}`);
}

/** All steps completed in SQLite; task evicted from memory (HTTP path loads via loadTaskFromDb). */
async function createIdleTask(rootDir, mode, url) {
  const { task_id: taskId } = await orchestrator.createTask({
    url,
    focus: '',
    mode,
    force: 0,
    output_lang: 'zh-CN',
    rootDir
  });
  const id = taskId;
  const db = createDb(rootDir);
  for (const s of orchestrator.STEPS) {
    db.writeStepState(id, s, { status: 'completed', attempts: 1, error: null });
  }
  orchestrator._dropTaskFromMemory(id);
  return id;
}

function stubRunStepForMediaSteps() {
  const orig = orchestrator.runStep;
  orchestrator.runStep = async function stubbedRunStep(taskId, stepName, options) {
    if (['fetch', 'video', 'audio', 'subs'].includes(stepName)) {
      return { success: true, output: '[test stub]', stubbed: true };
    }
    return orig.call(orchestrator, taskId, stepName, options);
  };
  return () => {
    orchestrator.runStep = orig;
  };
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-rscope-all-'));
  const token = 'test-rscope-all-token';
  const app = createApp({
    rootDir: tmp,
    token,
    runTaskForDownstream: async () => {}
  });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function jsonRequest(reqPath, options = {}) {
    const res = await fetch(base + reqPath, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
      ...options
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      throw new Error(`Invalid JSON from ${reqPath}: ${text}`);
    }
    return { status: res.status, body };
  }

  try {
    for (const mode of MODES) {
      const excluded = excludedByMode(mode);
      for (const stepName of ALL_STEPS) {
        const url = `https://example.com/watch?v=rscope-all-${runStepSeq++}`;
        const taskDown = await createIdleTask(tmp, mode, url);

        const down = await jsonRequest(`/api/tasks/${taskDown}/steps/${stepName}/run`, {
          method: 'POST',
          body: JSON.stringify({ reset_scope: 'downstream' })
        });

        if (excluded.has(stepName)) {
          assert.strictEqual(down.status, 400, `downstream ${mode}/${stepName} expected 400`);
          assert.strictEqual(down.body.code, 'BAD_ANCHOR_MODE', `downstream ${mode}/${stepName}`);
        } else {
          assert.strictEqual(down.status, 202, `downstream ${mode}/${stepName} expected 202`);
          assert.strictEqual(down.body.accepted, true);
          sameStepSet(down.body.reset_steps, [...getDownstreamClosure(stepName)]);
        }

        const url2 = `https://example.com/watch?v=rscope-all-${runStepSeq++}`;
        const taskStep = await createIdleTask(tmp, mode, url2);

        const mediaSteps = ['fetch', 'video', 'audio', 'subs'];
        const useStub = !excluded.has(stepName) && mediaSteps.includes(stepName);
        const restore = useStub ? stubRunStepForMediaSteps() : () => {};

        let stepRes;
        try {
          stepRes = await jsonRequest(`/api/tasks/${taskStep}/steps/${stepName}/run`, {
            method: 'POST',
            body: JSON.stringify({ reset_scope: 'step', force: true })
          });
        } finally {
          restore();
        }

        // translate skips-with-success when original_en.md is absent (Skip-2 in
        // runStep's translate case). The fixture writes no artifact files, so
        // translate always skips → 202, unlike other A-layer steps which fail → 400.
        const skipsWhenInputMissing = ['translate'];

        if (excluded.has(stepName)) {
          assert.strictEqual(stepRes.status, 400, `step ${mode}/${stepName} expected 400`);
          assert.strictEqual(stepRes.body.code, 'BAD_ANCHOR_MODE', `step ${mode}/${stepName}`);
        } else if (useStub) {
          assert.strictEqual(stepRes.status, 202, `step stub ${mode}/${stepName}`);
          assert.strictEqual(stepRes.body.success, true);
          assert.ok(Array.isArray(stepRes.body.reset_steps));
          assert.ok(stepRes.body.reset_steps.includes(stepName), `reset_steps should include ${stepName}`);
        } else if (skipsWhenInputMissing.includes(stepName)) {
          assert.strictEqual(stepRes.status, 202, `step skip ${mode}/${stepName} expected 202`);
          assert.strictEqual(stepRes.body.success, true, `step skip ${mode}/${stepName}`);
        } else {
          assert.strictEqual(stepRes.status, 400, `step A-layer ${mode}/${stepName} expected 400`);
          assert.strictEqual(stepRes.body.success, false);
          assert.ok(Array.isArray(stepRes.body.reset_steps));
          assert.ok(stepRes.body.reset_steps.includes(stepName));
        }
      }
    }

    const badStep = await jsonRequest(`/api/tasks/${await createIdleTask(tmp, 'transcript', 'https://example.com/watch?v=badstep')}/steps/not-a-step/run`, {
      method: 'POST',
      body: JSON.stringify({ reset_scope: 'step' })
    });
    assert.strictEqual(badStep.status, 404);

    console.log('reset-scope-all-steps-http.test.js: PASS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      // ignore
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
