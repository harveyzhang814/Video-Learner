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
    asr: pending(),
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

    // excludedByMode: full mode — video and audio not excluded (asr excluded until subs fails)
    {
      assert.ok(!excludedByMode('full').has('video'), 'full: video not excluded');
      assert.ok(!excludedByMode('full').has('audio'), 'full: audio not excluded');
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

    // excludedByMode: asr — excluded when subs not failed
    {
      const subsNotFailed = { subs: { status: 'pending' }, video: { status: 'completed' } };
      assert.ok(excludedByMode('media', subsNotFailed).has('asr'), 'asr excluded when subs not failed');
    }

    // excludedByMode: asr — excluded in transcript mode even if subs failed
    {
      const subsFailed = { subs: { status: 'failed' }, video: { status: 'completed' } };
      assert.ok(excludedByMode('transcript', subsFailed).has('asr'), 'asr excluded in transcript mode');
    }

    // excludedByMode: asr — excluded in media mode when video not yet completed
    {
      const subsFailed = { subs: { status: 'failed' }, video: { status: 'pending' } };
      assert.ok(excludedByMode('media', subsFailed).has('asr'), 'asr excluded when video pending');
    }

    // excludedByMode: asr — NOT excluded in media mode when subs failed and video completed
    {
      const subsFailed = { subs: { status: 'failed' }, video: { status: 'completed' } };
      assert.ok(!excludedByMode('media', subsFailed).has('asr'), 'asr allowed when subs failed + video completed');
    }

    // excludedByMode: asr — NOT excluded in media mode when video failed but audio completed
    {
      const steps = { subs: { status: 'failed' }, video: { status: 'failed' }, audio: { status: 'completed' } };
      assert.ok(!excludedByMode('media', steps).has('asr'), 'asr allowed when video failed + audio completed');
    }

    // excludedByMode: asr — excluded in audio mode when audio not yet completed
    {
      const steps = { subs: { status: 'failed' }, audio: { status: 'pending' } };
      assert.ok(excludedByMode('audio', steps).has('asr'), 'asr excluded in audio mode when audio pending');
    }

    // excludedByMode: asr — NOT excluded in audio mode when subs failed and audio completed
    {
      const steps = { subs: { status: 'failed' }, audio: { status: 'completed' } };
      assert.ok(!excludedByMode('audio', steps).has('asr'), 'asr allowed in audio mode when audio completed');
    }

    // media: fetch completed → subs+video ready, audio excluded; pick subs
    {
      const steps = baseSteps();
      steps.fetch = completed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('subs'), 'ready should contain subs');
      assert.ok(ready.has('video'), 'ready should contain video');
      assert.ok(!ready.has('audio'), 'audio must not be ready before video fails');
      assert.strictEqual(pickNextStep(ready, 'media', task.steps), 'subs');
    }

    // media: video failed → audio becomes ready; pick audio
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = completed();
      steps.vtt2md = completed();
      steps.md2vtt = completed();
      steps.article = completed();
      steps.summary = completed();
      steps.video = failed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('audio'), 'audio must be ready after video failed');
      assert.strictEqual(pickNextStep(ready, 'media', task.steps), 'audio');
    }

    // full: fetch completed → subs + video + audio all ready; pick subs (primary first)
    {
      const steps = baseSteps();
      steps.fetch = completed();
      const task = { params: { mode: 'full' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('subs'), 'full: subs ready');
      assert.ok(ready.has('video'), 'full: video ready');
      assert.ok(ready.has('audio'), 'full: audio ready');
      assert.strictEqual(pickNextStep(ready, 'full', task.steps), 'subs');
    }

    // full: all primary done, video+audio pending → pick video before audio
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = completed();
      steps.vtt2md = completed();
      steps.md2vtt = completed();
      steps.article = completed();
      steps.summary = completed();
      const task = { params: { mode: 'full' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('video'), 'full: video ready');
      assert.ok(ready.has('audio'), 'full: audio ready');
      assert.strictEqual(pickNextStep(ready, 'full', task.steps), 'video');
    }

    // vtt2md completed; article+md2vtt pending → pick article (main before secondary)
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = completed();
      steps.vtt2md = completed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('article'));
      assert.ok(ready.has('md2vtt'));
      assert.strictEqual(pickNextStep(ready, 'media', task.steps), 'article');
    }

    // subs failed → vtt2md not ready
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = failed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(!ready.has('vtt2md'), 'vtt2md must not be ready when subs failed');
    }

    // vtt2md OR: subs=completed → vtt2md ready (asr stays pending/excluded)
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = completed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('vtt2md'), 'vtt2md ready when subs=completed');
    }

    // vtt2md OR: subs=failed + asr=completed → vtt2md ready
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = failed();
      steps.asr = completed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('vtt2md'), 'vtt2md ready when asr=completed');
    }

    // vtt2md OR: subs=failed + asr=failed → vtt2md NOT ready
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = failed();
      steps.asr = failed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(!ready.has('vtt2md'), 'vtt2md not ready when both subs and asr failed');
    }

    // asr scheduled after subs=failed + video=completed (media mode)
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = failed();
      steps.video = completed();
      const task = { params: { mode: 'media' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('asr'), 'asr ready when subs=failed + video=completed');
      assert.ok(!ready.has('vtt2md'), 'vtt2md not ready until asr completes');
    }

    // vtt2md OR: subs=skipped + asr=pending (excluded) → vtt2md ready
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.subs = { status: 'skipped', attempts: 0, error: null };
      const task = { params: { mode: 'transcript' }, steps };
      const ready = computeReadySteps(task);
      assert.ok(ready.has('vtt2md'), 'vtt2md ready when subs=skipped');
    }

    // video failed, fetch completed, subs pending → subs still ready
    {
      const steps = baseSteps();
      steps.fetch = completed();
      steps.video = failed();
      const task = { params: { mode: 'media' }, steps };
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

    // isNodeReachable tests
    {
      const { isNodeReachable } = require('../core/orchestrator/schedule');

      function skipped() { return { status: 'skipped', attempts: 0, error: null }; }
      function running() { return { status: 'running',  attempts: 1, error: null }; }

      // Root node: fetch=pending, no predecessors → reachable
      {
        const steps = baseSteps();
        assert.strictEqual(isNodeReachable('fetch', steps, 'media', new Set()), true,
          'fetch pending: reachable (root node)');
      }

      // fetch=failed → not reachable
      {
        const steps = baseSteps();
        steps.fetch = failed();
        assert.strictEqual(isNodeReachable('fetch', steps, 'media', new Set()), false,
          'fetch failed: not reachable');
      }

      // fetch=completed → reachable immediately
      {
        const steps = baseSteps();
        steps.fetch = completed();
        assert.strictEqual(isNodeReachable('fetch', steps, 'media', new Set()), true,
          'fetch completed: reachable');
      }

      // subs: fetch=completed, subs=pending → reachable
      {
        const steps = baseSteps();
        steps.fetch = completed();
        assert.strictEqual(isNodeReachable('subs', steps, 'media', new Set()), true,
          'subs pending + fetch completed: reachable');
      }

      // subs: fetch=failed, subs=pending → not reachable (predecessor failed)
      {
        const steps = baseSteps();
        steps.fetch = failed();
        assert.strictEqual(isNodeReachable('subs', steps, 'media', new Set()), false,
          'subs pending + fetch failed: not reachable');
      }

      // vtt2md OR gate: subs=completed, asr=pending → reachable (subs satisfies OR)
      {
        const steps = baseSteps();
        steps.fetch = completed();
        steps.subs = completed();
        assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), true,
          'vtt2md: subs=completed satisfies OR gate');
      }

      // vtt2md OR gate: subs=failed, asr=completed → reachable (asr satisfies OR)
      {
        const steps = baseSteps();
        steps.fetch = completed();
        steps.subs = failed();
        steps.asr = completed();
        assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), true,
          'vtt2md: asr=completed satisfies OR gate');
      }

      // vtt2md OR gate: subs=failed, asr=failed → not reachable
      {
        const steps = baseSteps();
        steps.fetch = completed();
        steps.subs = failed();
        steps.asr = failed();
        assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), false,
          'vtt2md: both subs and asr failed → not reachable');
      }

      // KEY: transcript mode, subs=failed, asr=pending+excluded → NOT reachable
      {
        const steps = baseSteps();
        steps.fetch = completed();
        steps.subs = failed();
        assert.strictEqual(isNodeReachable('vtt2md', steps, 'transcript', new Set()), false,
          'vtt2md: transcript mode, subs=failed, asr=excluded+pending → not reachable');
      }

      // media mode, subs=failed, asr=pending, video=pending → asr excluded → not reachable
      {
        const steps = baseSteps();
        steps.fetch = completed();
        steps.subs = failed();
        steps.video = pending();
        assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), false,
          'vtt2md: media mode, subs=failed, asr excluded (video pending) → not reachable');
      }

      // media mode, subs=failed, asr=pending, video=completed → asr runnable → vtt2md reachable
      {
        const steps = baseSteps();
        steps.fetch = completed();
        steps.subs = failed();
        steps.video = completed();
        assert.strictEqual(isNodeReachable('vtt2md', steps, 'media', new Set()), true,
          'vtt2md: media mode, subs=failed, video=completed → asr runnable → reachable');
      }
    }

    console.log('orchestrator-schedule.test.js: PASS');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
