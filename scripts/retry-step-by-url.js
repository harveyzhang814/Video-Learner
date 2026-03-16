#!/usr/bin/env node
'use strict';

/**
 * One-off script: start HTTP server, then retry fetch and video steps for a task by URL.
 * Usage: node scripts/retry-step-by-url.js "https://www.youtube.com/watch?v=CEvIs9y1uog"
 */

const http = require('http');
const crypto = require('crypto');
const { createApp } = require('../services/http-server');

const url = process.argv[2] || 'https://www.youtube.com/watch?v=CEvIs9y1uog';
const taskId = crypto.createHash('sha1').update(url + '\n').digest('hex').slice(0, 12);

async function main() {
  const app = createApp();
  const server = http.createServer(app.callback());
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  async function jsonRequest(path, options = {}) {
    const res = await fetch(base + path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_) {
      body = text;
    }
    return { status: res.status, body };
  }

  console.log(`[retry] taskId=${taskId} url=${url}`);
  console.log(`[retry] server at ${base}`);

  // 1) Ensure task exists (GET); if 404, create
  let getRes = await jsonRequest(`/api/tasks/${taskId}`);
  if (getRes.status === 404) {
    console.log('[retry] task not found, creating...');
    const createRes = await jsonRequest('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ url, focus: '', mode: 'both', force: false, output_lang: 'zh-CN' })
    });
    if (createRes.status !== 201) {
      console.error('[retry] create failed:', createRes);
      server.close();
      process.exit(1);
    }
    console.log('[retry] task created');
  } else if (getRes.status !== 200) {
    console.error('[retry] get task failed:', getRes.status, getRes.body);
    server.close();
    process.exit(1);
  }

  // 2) Retry fetch
  console.log('[retry] POST steps/fetch/run force=true ...');
  const fetchRes = await jsonRequest(`/api/tasks/${taskId}/steps/fetch/run`, {
    method: 'POST',
    body: JSON.stringify({ force: true })
  });
  console.log('[retry] fetch result:', fetchRes.status, fetchRes.body?.success, fetchRes.body?.output || fetchRes.body?.error || '');

  if (fetchRes.status !== 202 && fetchRes.status !== 400) {
    console.error('[retry] unexpected fetch status:', fetchRes);
  }
  if (fetchRes.body && !fetchRes.body.success && fetchRes.body.output) {
    console.log('[retry] fetch error:', fetchRes.body.output);
  }

  // 3) Retry video
  console.log('[retry] POST steps/video/run force=true ...');
  const videoRes = await jsonRequest(`/api/tasks/${taskId}/steps/video/run`, {
    method: 'POST',
    body: JSON.stringify({ force: true })
  });
  console.log('[retry] video result:', videoRes.status, videoRes.body?.success, videoRes.body?.output || videoRes.body?.error || '');

  if (videoRes.body && !videoRes.body.success && videoRes.body.output) {
    console.log('[retry] video error:', videoRes.body.output);
  }

  server.close();
  console.log('[retry] done.');
}

main().catch((err) => {
  console.error('[retry]', err);
  process.exit(1);
});
