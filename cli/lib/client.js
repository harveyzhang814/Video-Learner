'use strict';
const http = require('http');

let _base = 'http://127.0.0.1:3000';
let _token = '';

function init(base, token) {
  _base = base;
  _token = token;
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(_base + urlPath);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: Number(url.port) || 3000,
      path: url.pathname + url.search,
      method,
      headers: {
        Authorization: `Bearer ${_token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function createTask(params) {
  const r = await request('POST', '/api/tasks', params);
  if (r.status !== 201 && r.status !== 200) {
    throw new Error(r.body?.error?.message || r.body?.error || `HTTP ${r.status}`);
  }
  return r.body.task_id;
}

async function getTask(taskId) {
  const r = await request('GET', `/api/tasks/${taskId}`);
  if (r.status === 404) throw new Error(`task not found: ${taskId}`);
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  return r.body;
}

async function runStep(taskId, stepName, opts) {
  const r = await request('POST', `/api/tasks/${taskId}/steps/${stepName}/run`, opts || {});
  return { status: r.status, body: r.body };
}

function getResultContent(taskId, type) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${_base}/api/tasks/${taskId}/result/content?type=${type}`);
    const options = {
      hostname: url.hostname,
      port: Number(url.port) || 3000,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { Authorization: `Bearer ${_token}` },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { init, createTask, getTask, runStep, getResultContent };
