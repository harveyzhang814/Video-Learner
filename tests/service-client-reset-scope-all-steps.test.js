'use strict';

/**
 * GUI stack (ServiceClient): same matrix as reset-scope-all-steps-http.test.js
 * — verifies renderer client sends reset_scope and parses responses like Agent HTTP.
 * Note: ServiceClient throws on !res.ok, so 400 paths use try/catch.
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { createApp } = require('../services/http-server');
const { createDb } = require('../core/orchestrator/db');
const orchestrator = require('../core/orchestrator');
const { ALL_STEPS, excludedByMode, getDownstreamClosure } = require('../core/orchestrator/schedule');

const MODES = ['transcript', 'both', 'video', 'audio'];
const TOKEN = 'test-reset-scope-all-steps';
let runStepSeq = 0;

function sortNames(arr) {
  return [...(arr || [])].sort();
}

function sameStepSet(a, b) {
  assert.deepStrictEqual(sortNames(a), sortNames(b));
}

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

async function expectClientError(fn, label) {
  try {
    await fn();
    assert.fail(`${label}: expected thrown 4xx`);
  } catch (e) {
    const m = String(e && e.message ? e.message : e);
    assert.ok(/^(400|404|409) /.test(m), `${label}: ${m}`);
  }
}

async function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-rscope-client-'));
  const app = createApp({
    rootDir: tmp,
    token: TOKEN,
    runTaskForDownstream: async () => {}
  });
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const modulePath = pathToFileURL(path.join(__dirname, '..', 'electron', 'src', 'renderer', 'service-client.js')).href;
  const { ServiceClient } = await import(modulePath);
  const client = new ServiceClient({ baseUrl, token: TOKEN });

  try {
    for (const mode of MODES) {
      const excluded = excludedByMode(mode);
      for (const stepName of ALL_STEPS) {
        const url = `https://example.com/watch?v=rscope-cli-${runStepSeq++}`;
        const taskDown = await createIdleTask(tmp, mode, url);

        if (excluded.has(stepName)) {
          await expectClientError(
            () => client.runStep(taskDown, stepName, { reset_scope: 'downstream' }),
            `downstream ${mode}/${stepName}`
          );
        } else {
          const downBody = await client.runStep(taskDown, stepName, { reset_scope: 'downstream' });
          assert.strictEqual(downBody.accepted, true);
          sameStepSet(downBody.reset_steps, [...getDownstreamClosure(stepName)]);
        }

        const url2 = `https://example.com/watch?v=rscope-cli-${runStepSeq++}`;
        const taskStep = await createIdleTask(tmp, mode, url2);
        const mediaSteps = ['fetch', 'video', 'audio', 'subs'];
        const useStub = !excluded.has(stepName) && mediaSteps.includes(stepName);
        const restore = useStub ? stubRunStepForMediaSteps() : () => {};

        try {
          if (excluded.has(stepName)) {
            await expectClientError(
              () => client.runStep(taskStep, stepName, { reset_scope: 'step', force: true }),
              `step ${mode}/${stepName}`
            );
          } else if (useStub) {
            const stepBody = await client.runStep(taskStep, stepName, {
              reset_scope: 'step',
              force: true
            });
            assert.strictEqual(stepBody.success, true);
            assert.ok(stepBody.reset_steps.includes(stepName));
          } else if (stepName === 'translate') {
            // translate skips-with-success when original_en.md is absent (Skip-2);
            // the fixture writes no artifact files, so it returns success rather
            // than a 4xx like other A-layer steps.
            const stepBody = await client.runStep(taskStep, stepName, {
              reset_scope: 'step',
              force: true
            });
            assert.strictEqual(stepBody.success, true, `step skip ${mode}/${stepName}`);
          } else {
            await expectClientError(
              () => client.runStep(taskStep, stepName, { reset_scope: 'step', force: true }),
              `step A-layer ${mode}/${stepName}`
            );
          }
        } finally {
          restore();
        }
      }
    }

    const lastId = await createIdleTask(tmp, 'transcript', 'https://example.com/watch?v=badstep-cli');
    await expectClientError(
      () => client.runStep(lastId, 'not-a-step', { reset_scope: 'step' }),
      'unknown step'
    );

    console.log('service-client-reset-scope-all-steps.test.js: PASS');
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
