'use strict';

const assert = require('assert');
const { computeReadySteps, pickNextStep, getDownstreamClosure, normalizeMode, excludedByMode } = require('../core/orchestrator/schedule');

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
    // normalizeMode: old names map to new names
    assert.strictEqual(normalizeMode('both'), 'media');
    assert.strictEqual(normalizeMode('video'), 'media');
    assert.strictEqual(normalizeMode('media'), 'media');
    assert.strictEqual(normalizeMode('audio'), 'audio');
    assert.strictEqual(normalizeMode('transcript'), 'transcript');
    assert.strictEqual(normalizeMode('full'), 'full');
    assert.strictEqual(normalizeMode(''), 'media');
    assert.strictEqual(normalizeMode(undefined), 'media');
    assert.strictEqual(normalizeMode('garbage'), 'media');

    // excludedByMode: media mode — audio excluded until video fails
    {
      const noSteps = undefined;
      assert.ok(excludedByMode('media', noSteps).has('audio'), 'media: audio excluded when video not failed');
      assert.ok(!excludedByMode('media', noSteps).has('video'), 'media: video not excluded');

      const videoFailed = { video: { status: 'failed' } };
      assert.ok(!excludedByMode('media', videoFailed).has('audio'), 'media: audio allowed after video failed');

      const videoPending = { video: { status: 'pending' } };
      assert.ok(excludedByMode('media', videoPending).has('audio'), 'media: audio excluded when video pending');
    }

    // excludedByMode: full mode — nothing excluded
    {
      assert.strictEqual(excludedByMode('full').size, 0, 'full: nothing excluded');
    }

    // excludedByMode: audio mode — video excluded
    {
      assert.ok(excludedByMode('audio').has('video'), 'audio: video excluded');
      assert.ok(!excludedByMode('audio').has('audio'), 'audio: audio not excluded');
    }

    // excludedByMode: transcript mode — both excluded
    {
      assert.ok(excludedByMode('transcript').has('video'), 'transcript: video excluded');
      assert.ok(excludedByMode('transcript').has('audio'), 'transcript: audio excluded');
    }

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

    // getDownstreamClosure: vtt2md → vtt2md, md2vtt, article, summary
    {
      const c = getDownstreamClosure('vtt2md');
      assert.ok(c.has('vtt2md') && c.has('md2vtt') && c.has('article') && c.has('summary'));
      assert.ok(!c.has('fetch'));
    }
    // summary → only itself
    {
      const c = getDownstreamClosure('summary');
      assert.strictEqual(c.size, 1);
      assert.ok(c.has('summary'));
    }

    console.log('orchestrator-schedule.test.js: PASS');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
