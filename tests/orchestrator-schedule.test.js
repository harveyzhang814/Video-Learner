'use strict';

const assert = require('assert');
const { computeReadySteps, pickNextStep } = require('../core/orchestrator/schedule');

function pending() {
  return { status: 'pending', attempts: 0, error: null };
}

function completed() {
  return { status: 'completed', attempts: 1, error: null };
}

function failed() {
  return { status: 'failed', attempts: 1, error: 'x' };
}

function baseSteps() {
  return {
    fetch: pending(),
    video: pending(),
    audio: pending(),
    subs: pending(),
    vtt2md: pending(),
    md2vtt: pending(),
    article: pending(),
    summary: pending()
  };
}

function run() {
  try {
    // both: fetch completed, subs+video pending → ready subs+video; pick subs
    {
      const steps = baseSteps();
      steps.fetch = completed();
      const task = { params: { mode: 'both' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('subs'), 'ready should contain subs');
      assert.ok(ready.has('video'), 'ready should contain video');
      assert.strictEqual(pickNextStep(ready, 'both'), 'subs');
    }

    // vtt2md completed; article+md2vtt pending → pick article (main before secondary)
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.video = completed();
      steps.subs = completed();
      steps.vtt2md = completed();
      const task = { params: { mode: 'both' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('article'));
      assert.ok(ready.has('md2vtt'));
      assert.strictEqual(pickNextStep(ready, 'both'), 'article');
    }

    // subs failed → vtt2md not ready
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = failed();
      const task = { params: { mode: 'both' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(!ready.has('vtt2md'), 'vtt2md must not be ready when subs failed');
    }

    // video failed, fetch completed, subs pending → subs still ready
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.video = failed();
      const task = { params: { mode: 'both' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('subs'), 'subs should be ready despite video failed');
    }

    console.log('orchestrator-schedule.test.js: PASS');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
