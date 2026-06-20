'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { createApp } = require('../services/http-server');

const TOKEN = 'notes-test-token';
const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

let server;

async function req(method, urlPath, body) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`http://127.0.0.1:${server.address().port}${urlPath}`, opts);
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
  return { status: res.status, body: json };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-notes-'));

  try {
    const app = createApp({ rootDir: tmp, token: TOKEN, host: '127.0.0.1' });
    server = http.createServer(app.callback()).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));

    // ── Fixture: create a real task ──────────────────────────────────────────
    const createRes = await req('POST', '/api/tasks', { url: URL, mode: 'transcript', force: 1 });
    assert.equal(createRes.status, 201, `create task failed: ${JSON.stringify(createRes.body)}`);
    const taskId = createRes.body.task_id;
    assert.ok(taskId, 'expected task_id in response');

    const notesBase = `/api/tasks/${taskId}/notes`;

    // ── 1. GET empty list ────────────────────────────────────────────────────
    {
      const r = await req('GET', notesBase);
      assert.equal(r.status, 200, `1. GET empty: expected 200, got ${r.status}`);
      assert.ok(Array.isArray(r.body), '1. GET empty: expected array');
      assert.equal(r.body.length, 0, '1. GET empty: expected 0 notes');
      console.log('  PASS 1. GET empty list');
    }

    // ── 2. POST missing body → 400 ───────────────────────────────────────────
    {
      const r = await req('POST', notesBase, {});
      assert.equal(r.status, 400, `2. POST missing body: expected 400, got ${r.status}`);
      console.log('  PASS 2. POST missing body → 400');
    }

    // ── 3. POST whitespace-only body → 400 ──────────────────────────────────
    {
      const r = await req('POST', notesBase, { body: '   ' });
      assert.equal(r.status, 400, `3. POST whitespace body: expected 400, got ${r.status}`);
      console.log('  PASS 3. POST whitespace-only body → 400');
    }

    // ── 4. POST creates note (text only) ─────────────────────────────────────
    let noteId1;
    {
      const r = await req('POST', notesBase, { body: '第一条笔记' });
      assert.equal(r.status, 201, `4. POST create: expected 201, got ${r.status}`);
      const n = r.body;
      assert.ok(n.id, '4. note has id');
      assert.equal(n.body, '第一条笔记', '4. note body matches');
      assert.equal(n.anchor, '', '4. anchor defaults to empty string');
      assert.equal(n.mediaTimestamp, undefined, '4. no mediaTimestamp when not provided');
      assert.ok(typeof n.createdAt === 'number', '4. createdAt is number');
      assert.ok(typeof n.updatedAt === 'number', '4. updatedAt is number');
      noteId1 = n.id;
      console.log('  PASS 4. POST creates note (text only)');
    }

    // ── 5. POST creates note with mediaTimestamp ──────────────────────────────
    let noteId2;
    {
      const r = await req('POST', notesBase, { body: '带时间戳的笔记', mediaTimestamp: 42 });
      assert.equal(r.status, 201, `5. POST with timestamp: expected 201, got ${r.status}`);
      assert.equal(r.body.mediaTimestamp, 42, '5. mediaTimestamp preserved');
      noteId2 = r.body.id;
      console.log('  PASS 5. POST creates note with mediaTimestamp');
    }

    // ── 6. GET list returns both notes (newest first) ─────────────────────────
    {
      const r = await req('GET', notesBase);
      assert.equal(r.status, 200);
      assert.equal(r.body.length, 2, '6. list has 2 notes');
      assert.equal(r.body[0].id, noteId2, '6. newest note is first (unshift order)');
      assert.equal(r.body[1].id, noteId1, '6. older note is second');
      console.log('  PASS 6. GET list returns 2 notes (newest first)');
    }

    // ── 7. PATCH updates note body ────────────────────────────────────────────
    {
      const r = await req('PATCH', `${notesBase}/${noteId1}`, { body: '已修改的笔记' });
      assert.equal(r.status, 200, `7. PATCH: expected 200, got ${r.status}`);
      assert.equal(r.body.body, '已修改的笔记', '7. body updated');
      assert.ok(r.body.updatedAt >= r.body.createdAt, '7. updatedAt >= createdAt after update');
      console.log('  PASS 7. PATCH updates note body');
    }

    // ── 8. GET confirms patch persisted ──────────────────────────────────────
    {
      const r = await req('GET', notesBase);
      const n1 = r.body.find((n) => n.id === noteId1);
      assert.ok(n1, '8. note1 still in list');
      assert.equal(n1.body, '已修改的笔记', '8. patched body persisted');
      console.log('  PASS 8. PATCH persisted after GET');
    }

    // ── 9. PATCH missing body → 400 ──────────────────────────────────────────
    {
      const r = await req('PATCH', `${notesBase}/${noteId1}`, {});
      assert.equal(r.status, 400, `9. PATCH missing body: expected 400, got ${r.status}`);
      console.log('  PASS 9. PATCH missing body → 400');
    }

    // ── 10. PATCH non-existent note → 404 ────────────────────────────────────
    {
      const r = await req('PATCH', `${notesBase}/does-not-exist`, { body: 'x' });
      assert.equal(r.status, 404, `10. PATCH 404: expected 404, got ${r.status}`);
      console.log('  PASS 10. PATCH non-existent note → 404');
    }

    // ── 11. DELETE removes note ───────────────────────────────────────────────
    {
      const r = await req('DELETE', `${notesBase}/${noteId2}`);
      assert.equal(r.status, 204, `11. DELETE: expected 204, got ${r.status}`);
      console.log('  PASS 11. DELETE removes note → 204');
    }

    // ── 12. GET confirms delete ───────────────────────────────────────────────
    {
      const r = await req('GET', notesBase);
      assert.equal(r.body.length, 1, '12. list has 1 note after delete');
      assert.equal(r.body[0].id, noteId1, '12. remaining note is noteId1');
      assert.equal(r.body.find((n) => n.id === noteId2), undefined, '12. deleted note gone');
      console.log('  PASS 12. DELETE confirmed by GET');
    }

    // ── 13. DELETE non-existent note → 404 ───────────────────────────────────
    {
      const r = await req('DELETE', `${notesBase}/does-not-exist`);
      assert.equal(r.status, 404, `13. DELETE 404: expected 404, got ${r.status}`);
      console.log('  PASS 13. DELETE non-existent note → 404');
    }

    // ── 14. DELETE same note twice → 404 on second call ──────────────────────
    {
      // first delete noteId1
      const r1 = await req('DELETE', `${notesBase}/${noteId1}`);
      assert.equal(r1.status, 204, '14. first delete 204');
      // second delete same id
      const r2 = await req('DELETE', `${notesBase}/${noteId1}`);
      assert.equal(r2.status, 404, '14. second delete 404 (idempotent guard)');
      console.log('  PASS 14. DELETE twice → 404 on second call');
    }

    // ── 15. GET on unknown task → 404 ────────────────────────────────────────
    {
      const r = await req('GET', '/api/tasks/unknowntask00/notes');
      assert.equal(r.status, 404, `15. GET unknown task: expected 404, got ${r.status}`);
      console.log('  PASS 15. GET on unknown task → 404');
    }

    // ── 16. POST on unknown task → 404 ───────────────────────────────────────
    {
      const r = await req('POST', '/api/tasks/unknowntask00/notes', { body: 'x' });
      assert.equal(r.status, 404, `16. POST unknown task: expected 404, got ${r.status}`);
      console.log('  PASS 16. POST on unknown task → 404');
    }

    // ── 17. PATCH on unknown task → 404 ──────────────────────────────────────
    {
      const r = await req('PATCH', '/api/tasks/unknowntask00/notes/someid', { body: 'x' });
      assert.equal(r.status, 404, `17. PATCH unknown task: expected 404, got ${r.status}`);
      console.log('  PASS 17. PATCH on unknown task → 404');
    }

    // ── 18. DELETE on unknown task → 404 ─────────────────────────────────────
    {
      const r = await req('DELETE', '/api/tasks/unknowntask00/notes/someid');
      assert.equal(r.status, 404, `18. DELETE unknown task: expected 404, got ${r.status}`);
      console.log('  PASS 18. DELETE on unknown task → 404');
    }

    // ── 19. Unauthenticated requests → 401 ───────────────────────────────────
    {
      const res = await fetch(
        `http://127.0.0.1:${server.address().port}${notesBase}`,
        { headers: { Authorization: 'Bearer wrong-token' } }
      );
      assert.equal(res.status, 401, `19. unauthed GET: expected 401, got ${res.status}`);
      console.log('  PASS 19. Unauthenticated request → 401');
    }

    // ── 20. notes.json written to correct path ────────────────────────────────
    {
      // Re-create a note so there's a file to inspect
      await req('POST', notesBase, { body: '文件路径验证' });
      // taskId returned by POST /api/tasks is the same as meta.id used for dirs
      const notesFile = path.join(tmp, 'work', taskId, 'notes.json');
      assert.ok(fs.existsSync(notesFile), `20. notes.json exists at ${notesFile}`);
      const contents = JSON.parse(fs.readFileSync(notesFile, 'utf8'));
      assert.ok(Array.isArray(contents), '20. notes.json is a JSON array');
      assert.ok(contents.length >= 1, '20. notes.json has at least one entry');
      console.log('  PASS 20. notes.json written to correct path');
    }

    server.close();
    console.log('\nPASS http-notes');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => {
  if (server) server.close();
  console.error(e);
  process.exit(1);
});
