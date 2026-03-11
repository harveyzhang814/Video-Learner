'use strict';

/**
 * SSE 端到端测试：
 * - 启动本地 HTTP 服务（用固定测试端口 + 固定 token）
 * - 连接 /api/events?token=...，验证能收到 connected/ping
 * - 创建任务后，验证能收到至少一条 task.* 事件
 * - 带 Last-Event-Id 重连一次，验证不会 4xx/崩溃
 */

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startService(port, token) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(port),
      AGENT_EVENTS_TOKEN: token
    };
    const entry = path.join(ROOT_DIR, 'services', 'http-server', 'index.js');
    const child = spawn(process.execPath, [entry], {
      cwd: ROOT_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let ready = false;

    const onData = (buf) => {
      const line = buf.toString('utf8');
      if (line.includes('Agent HTTP service listening')) {
        ready = true;
        resolve({ child });
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', (b) => process.stderr.write('[sse-e2e service] ' + b));

    child.on('exit', (code, signal) => {
      if (!ready) reject(new Error(`service exited prematurely: ${code} ${signal}`));
    });
  });
}

function jsonRequest(baseUrl, pathname, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const data = body ? Buffer.from(body, 'utf8') : null;

    const req = http.request(
      url,
      {
        method,
        headers: data
          ? {
              'Content-Type': 'application/json',
              'Content-Length': String(data.length)
            }
          : {}
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          let parsed = null;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch (e) {
              return reject(new Error(`Invalid JSON from ${pathname}: ${text.slice(0, 200)}`));
            }
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  const port = 59401;
  const token = 'sse-e2e-token';
  const base = `http://127.0.0.1:${port}`;

  console.log('[sse-e2e] starting service on', base);
  const { child } = await startService(port, token);

  try {
    // 1) 建立 SSE 连接，验证 connected / ping
    console.log('[sse-e2e] connecting SSE...');
    const frames = [];
    const sseReq = http.get(`${base}/api/events?token=${token}`, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';
        for (const frame of parts) {
          if (!frame.trim()) continue;
          frames.push(frame);
        }
      });
    });
    sseReq.on('error', (e) => {
      console.error('[sse-e2e] SSE error:', e);
    });

    await sleep(2000);
    if (!frames.some((f) => f.startsWith(': connected'))) {
      throw new Error('SSE did not send connected comment within 2s');
    }
    console.log('[sse-e2e] got connected frame');

    // 2) 创建任务，触发事件
    console.log('[sse-e2e] creating task...');
    const createRes = await jsonRequest(base, '/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        focus: 'sse-e2e',
        mode: 'transcript',
        force: 0,
        output_lang: 'zh-CN'
      })
    });
    if (createRes.status !== 201 || !createRes.body || !createRes.body.task_id) {
      throw new Error(`create task failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
    }
    const taskId = createRes.body.task_id;
    console.log('[sse-e2e] task_id:', taskId);

    await sleep(3000);

    const joined = frames.join('\n\n');
    if (!/event:\s*(task\.created|task\.updated)/.test(joined)) {
      console.warn('[sse-e2e] frames:\n', joined.slice(0, 400));
      throw new Error('did not observe any task.created/task.updated events in SSE stream');
    }
    console.log('[sse-e2e] observed task events in SSE');

    // 3) 带 Last-Event-Id 重连（这里只验证不会 4xx/崩溃）
    console.log('[sse-e2e] reconnecting with Last-Event-Id...');
    const lastIdLine = frames.findLast((f) => f.startsWith('id: ')) || '';
    const lastIdMatch = lastIdLine.match(/^id:\s*(\S+)/);
    const lastId = lastIdMatch ? lastIdMatch[1] : '0';

    await new Promise((resolve, reject) => {
      const req = http.get(
        `${base}/api/events?token=${token}`,
        {
          headers: { 'Last-Event-Id': lastId }
        },
        (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`reconnect SSE status ${res.statusCode}`));
          }
          let gotSomething = false;
          res.on('data', () => {
            gotSomething = true;
          });
          setTimeout(() => {
            if (!gotSomething) {
              console.warn('[sse-e2e] reconnect got no frames within 2s (may be idle but connection ok)');
            }
            resolve();
          }, 2000);
        }
      );
      req.on('error', reject);
    });

    console.log('[sse-e2e] reconnect with Last-Event-Id OK');
    console.log('[sse-e2e] PASS');
  } finally {
    try {
      child.kill('SIGTERM');
    } catch (_) {
      // ignore
    }
  }
}

run().catch((err) => {
  console.error('[sse-e2e] FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});

