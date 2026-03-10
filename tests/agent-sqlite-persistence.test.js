'use strict';

/**
 * Tests that task and step state are persisted to SQLite and that all
 * state updates (pending -> running -> completed/failed) are written correctly.
 * Uses repo root so scripts/* exist; asserts on work/database.sqlite.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const DatabaseManager = require('../electron/src/db');
const { createApp } = require('../services/http-server');

const ROOT_DIR = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT_DIR, 'work', 'database.sqlite');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonRequest(base, pathname, options = {}) {
  const res = await fetch(base + pathname, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON from ${pathname}: ${text.slice(0, 200)}`);
    }
  }
  return { status: res.status, body };
}

async function run() {
  const app = createApp(); // default rootDir = repo root
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  console.log('[persistence-test] server on', base);
  console.log('[persistence-test] DB path:', DB_PATH);

  try {
    // 1) Create task (this should create task + 8 steps in SQLite)
    const createRes = await jsonRequest(base, '/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        focus: 'sqlite persistence test',
        mode: 'transcript',
        force: 1,
        output_lang: 'zh-CN'
      })
    });

    if (createRes.status !== 201 || !createRes.body.task_id) {
      throw new Error(`create task failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
    }

    const taskId = createRes.body.task_id;
    console.log('[persistence-test] task_id:', taskId);

    // 2) Ensure work/ and database.sqlite exist (createTask creates them)
    await sleep(500);
    if (!fs.existsSync(DB_PATH)) {
      throw new Error(`database not found at ${DB_PATH}`);
    }

    const db = new DatabaseManager(DB_PATH);

    // 3) Assert task row exists and has correct fields
    const taskRow = db.getTask(taskId);
    if (!taskRow) {
      throw new Error('tasks table: no row for task_id ' + taskId);
    }
    if (taskRow.url !== 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') {
      throw new Error('tasks table: url mismatch ' + taskRow.url);
    }
    console.log('[persistence-test] task row OK:', taskRow.id, taskRow.url);

    // 4) Assert steps table has 8 rows for this task (all steps initialized)
    const stepsAfterCreate = db.getSteps(taskId);
    if (!Array.isArray(stepsAfterCreate) || stepsAfterCreate.length !== 8) {
      throw new Error(`steps table: expected 8 rows, got ${stepsAfterCreate?.length ?? 0}`);
    }
    const stepNames = stepsAfterCreate.map((s) => s.step_name).sort();
    const expectedSteps = ['article', 'audio', 'fetch', 'md2vtt', 'subs', 'summary', 'video', 'vtt2md'];
    if (JSON.stringify(stepNames) !== JSON.stringify(expectedSteps)) {
      throw new Error(`steps table: names mismatch ${JSON.stringify(stepNames)}`);
    }
    console.log('[persistence-test] 8 steps present after create');

    // 5) Run only the fetch step and wait for it to finish
    const runFetchRes = await jsonRequest(base, `/api/tasks/${taskId}/steps/fetch/run`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (runFetchRes.status !== 202 && runFetchRes.status !== 400) {
      throw new Error(`run fetch step failed: ${runFetchRes.status} ${JSON.stringify(runFetchRes.body)}`);
    }

    await sleep(2000);

    // 6) Assert fetch step status updated in SQLite to completed (or failed if yt-dlp fails)
    const stepsAfterFetch = db.getSteps(taskId);
    const fetchStep = stepsAfterFetch.find((s) => s.step_name === 'fetch');
    if (!fetchStep) {
      throw new Error('steps table: fetch step missing after run');
    }
    if (fetchStep.status !== 'completed' && fetchStep.status !== 'failed') {
      throw new Error(`steps table: fetch step status expected completed|failed, got ${fetchStep.status}`);
    }
    if (fetchStep.attempts < 1) {
      throw new Error(`steps table: fetch step attempts expected >= 1, got ${fetchStep.attempts}`);
    }
    console.log('[persistence-test] fetch step persisted:', fetchStep.status, 'attempts:', fetchStep.attempts);

    // 7) GET /api/tasks/:id and GET /api/tasks/:id/steps and ensure they match DB
    const getTaskRes = await jsonRequest(base, `/api/tasks/${taskId}`);
    if (getTaskRes.status !== 200 || !getTaskRes.body.meta) {
      throw new Error('GET /api/tasks/:id failed or missing meta');
    }
    if (getTaskRes.body.meta.id !== taskId || getTaskRes.body.meta.url !== taskRow.url) {
      throw new Error('GET task meta does not match DB task');
    }

    const getStepsRes = await jsonRequest(base, `/api/tasks/${taskId}/steps`);
    if (getStepsRes.status !== 200 || !Array.isArray(getStepsRes.body) || getStepsRes.body.length !== 8) {
      throw new Error('GET /api/tasks/:id/steps failed or wrong length');
    }
    const apiFetchStep = getStepsRes.body.find((s) => s.name === 'fetch');
    if (!apiFetchStep || apiFetchStep.status !== fetchStep.status) {
      throw new Error('API steps and SQLite steps out of sync for fetch');
    }
    console.log('[persistence-test] API and SQLite state consistent');

    db.close();
  } finally {
    server.close();
  }

  console.log('[persistence-test] all assertions passed');
}

run().catch((err) => {
  console.error('[persistence-test] FAILED:', err.message);
  process.exit(1);
});
