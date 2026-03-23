'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateStepArtifacts,
  canWriteOrCreateTaskDir,
  listOriginalMdFiles,
  hasVttInSubs
} = require('../core/orchestrator/stepArtifacts');

function makeTask(rootDir, id, url, mode = 'both') {
  return {
    params: { rootDir, mode },
    meta: { id, url }
  };
}

function run() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-step-art-'));

  try {
    const id = 'abc123def456';
    const url = 'https://example.com/watch?v=1';

    // rootDir not a directory
    const badFile = path.join(tmp, 'notadir');
    fs.writeFileSync(badFile, 'x');
    let r = validateStepArtifacts(makeTask(badFile, id, url), 'fetch');
    assert.strictEqual(r.ok, false);

    // good root + fetch
    const root = path.join(tmp, 'proj');
    fs.mkdirSync(root, { recursive: true });
    r = validateStepArtifacts(makeTask(root, id, url), 'fetch');
    assert.strictEqual(r.ok, true);

    // video needs url
    r = validateStepArtifacts(makeTask(root, id, ''), 'video');
    assert.strictEqual(r.ok, false);
    assert.ok(String(r.error).includes('url'));

    // vtt2md: no subs
    const taskDir = path.join(root, 'work', id);
    fs.mkdirSync(path.join(taskDir, 'transcript'), { recursive: true });
    r = validateStepArtifacts(makeTask(root, id, url), 'vtt2md');
    assert.strictEqual(r.ok, false);

    // vtt2md: subs empty
    const subs = path.join(taskDir, 'transcript', 'subs');
    fs.mkdirSync(subs, { recursive: true });
    r = validateStepArtifacts(makeTask(root, id, url), 'vtt2md');
    assert.strictEqual(r.ok, false);
    assert.ok(String(r.error).includes('.vtt'));

    fs.writeFileSync(path.join(subs, 'x.vtt'), 'WEBVTT\n');
    r = validateStepArtifacts(makeTask(root, id, url), 'vtt2md');
    assert.strictEqual(r.ok, true);

    // article / md2vtt: no md
    r = validateStepArtifacts(makeTask(root, id, url), 'article');
    assert.strictEqual(r.ok, false);

    fs.writeFileSync(path.join(taskDir, 'transcript', 'original_en.md'), '# t\n');
    r = validateStepArtifacts(makeTask(root, id, url), 'article');
    assert.strictEqual(r.ok, true);
    r = validateStepArtifacts(makeTask(root, id, url), 'md2vtt');
    assert.strictEqual(r.ok, true);

    // summary
    r = validateStepArtifacts(makeTask(root, id, url), 'summary');
    assert.strictEqual(r.ok, false);
    fs.mkdirSync(path.join(taskDir, 'writing'), { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'writing', 'article.md'), 'x');
    r = validateStepArtifacts(makeTask(root, id, url), 'summary');
    assert.strictEqual(r.ok, true);

    // listOriginalMdFiles
    const list = listOriginalMdFiles(path.join(taskDir, 'transcript'));
    assert.ok(list.includes('original_en.md'));

    assert.strictEqual(hasVttInSubs(subs), true);

    // read-only task dir (Unix)
    if (process.platform !== 'win32') {
      const roRoot = path.join(tmp, 'roproj');
      fs.mkdirSync(roRoot, { recursive: true });
      const roId = 'readonlyid01';
      const roTask = path.join(roRoot, 'work', roId);
      fs.mkdirSync(roTask, { recursive: true });
      fs.chmodSync(roTask, 0o555);
      const wr = canWriteOrCreateTaskDir(roRoot, roId);
      assert.strictEqual(wr.ok, false);
      fs.chmodSync(roTask, 0o755);
    }

    console.log('step-artifacts.test.js: PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run();
