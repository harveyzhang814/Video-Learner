'use strict';
/**
 * E2E test: Notes panel — full UI interaction against a live backend
 *
 * Strategy:
 *   1. Spin up an isolated test backend (random port, temp rootDir)
 *      serving the real web/dist build.
 *   2. Create a test task via API; write dummy article so the page renders.
 *   3. Playwright drives a headless Chromium browser through the full
 *      create → verify → edit → verify → delete → verify cycle.
 *   4. Teardown: server + temp dir are destroyed — zero residual state.
 *
 * Run: node tests/e2e-notes.test.js
 * Or:  npm run test:e2e:notes
 * To watch: E2E_HEADED=1 node tests/e2e-notes.test.js
 */

const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');
const os     = require('node:os');
const http   = require('node:http');
const { chromium } = require('playwright');
const { createApp } = require('../services/http-server');

// ── Config ───────────────────────────────────────────────────────────────────
const TOKEN   = 'e2e-notes-test-token';
const TIMEOUT = 15_000; // ms per UI assertion
const HEADLESS = process.env.E2E_HEADED !== '1';

// ── Helpers ──────────────────────────────────────────────────────────────────
let serverPort;
async function api(method, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${serverPort}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
  return { status: res.status, body: json };
}

function pass(msg) { console.log(`  PASS ${msg}`); }
function fail(msg, detail) {
  console.error(`  FAIL ${msg}${detail ? `\n       ${detail}` : ''}`);
  process.exitCode = 1;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // ── 1. Setup: isolated backend ────────────────────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-e2e-notes-'));

  // Copy the built web app into tmp so the backend can serve it
  const distSrc = path.join(__dirname, '..', 'web', 'dist');
  const distDst = path.join(tmp, 'web', 'dist');
  fs.mkdirSync(distDst, { recursive: true });
  fs.cpSync(distSrc, distDst, { recursive: true });

  const app = createApp({ rootDir: tmp, token: TOKEN, host: '127.0.0.1' });
  const server = http.createServer(app.callback()).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  serverPort = server.address().port;
  console.log(`\n[e2e-notes] backend on :${serverPort}  (tmp: ${tmp})`);

  // ── 2. Create a test task ─────────────────────────────────────────────────
  const createRes = await api('POST', '/api/tasks', {
    url: 'https://www.youtube.com/watch?v=e2e_notes_test',
    mode: 'transcript',
    force: 1,
  });
  assert.equal(createRes.status, 201, `task create failed: ${JSON.stringify(createRes.body)}`);
  const taskId = createRes.body.task_id;
  assert.ok(taskId, 'expected task_id');
  console.log(`[e2e-notes] test task: ${taskId}`);

  // Write dummy content so article tab renders
  const writingDir = path.join(tmp, 'work', taskId, 'writing');
  fs.mkdirSync(writingDir, { recursive: true });
  fs.writeFileSync(path.join(writingDir, 'article.md'), '# E2E Test Article\n\nDummy content for E2E notes test.\n');
  fs.writeFileSync(path.join(writingDir, 'summary.md'), '## Summary\n\nE2E test summary.\n');

  // ── 3. Launch browser ─────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  // Capture console errors for debugging
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  try {
    // ── 4. Navigate to task detail page ──────────────────────────────────────
    await page.goto(`http://127.0.0.1:${serverPort}/tasks/${taskId}`);
    await page.waitForLoadState('domcontentloaded');

    // Confirm the page loaded (layout shell element)
    await page.waitForSelector('.layout-shell', { timeout: TIMEOUT });
    pass('4. Task detail page loaded');

    // The test task has no media → auto-switches to Mode E (沉浸阅读).
    // In Mode E, notes appear in .notes-col (right sidebar of the article panel).
    // Scope all note selectors to the visible panel to avoid matching the
    // duplicate hidden panel in .left-notes (used only in Mode A).
    const notesPanel = page.locator('.notes-col').first();
    await notesPanel.waitFor({ state: 'visible', timeout: TIMEOUT });
    pass('4. Notes panel (.notes-col) visible in Mode E');

    // ── 5. Add first note ─────────────────────────────────────────────────────
    const noteInput = notesPanel.locator('textarea').first();
    await noteInput.waitFor({ state: 'visible' });
    await noteInput.click();
    await noteInput.fill('E2E测试笔记第一条');
    await noteInput.press('Meta+Enter');

    // Wait for the note to appear in the panel
    const note1Text = notesPanel.locator('p', { hasText: 'E2E测试笔记第一条' }).first();
    await note1Text.waitFor({ state: 'visible', timeout: TIMEOUT });
    pass('5. Note appears in UI after ⌘+Enter submit');

    // Verify via backend API
    const list1 = await api('GET', `/api/tasks/${taskId}/notes`);
    assert.equal(list1.status, 200, `list notes failed: ${list1.status}`);
    assert.equal(list1.body.length, 1, `expected 1 note, got ${list1.body.length}`);
    assert.equal(list1.body[0].body, 'E2E测试笔记第一条', 'note body mismatch in backend');
    const noteId1 = list1.body[0].id;
    pass('5. Note persisted in backend (GET /notes confirms)');

    // ── 6. Add second note ────────────────────────────────────────────────────
    await noteInput.waitFor({ state: 'visible' });
    await noteInput.fill('E2E测试笔记第二条');
    await noteInput.press('Meta+Enter');

    await notesPanel.locator('p', { hasText: 'E2E测试笔记第二条' }).first()
      .waitFor({ state: 'visible' });
    pass('6. Second note appears in UI');

    const list2 = await api('GET', `/api/tasks/${taskId}/notes`);
    assert.equal(list2.body.length, 2, `expected 2 notes, got ${list2.body.length}`);
    assert.equal(list2.body[0].body, 'E2E测试笔记第二条', 'second note should be first (unshift)');
    const noteId2 = list2.body[0].id;
    pass('6. Both notes in backend, newest first');

    // ── 7. Edit a note inline ─────────────────────────────────────────────────
    // Click on the note text to enter edit mode
    const note1El = notesPanel.locator('p', { hasText: 'E2E测试笔记第一条' }).first();
    await note1El.waitFor({ state: 'visible' });
    await note1El.click();

    // An auto-focused textarea should appear
    const editBox = notesPanel.locator('textarea').last();
    await editBox.waitFor({ state: 'visible' });
    await editBox.fill('E2E测试笔记第一条(已修改)');
    await editBox.press('Meta+Enter');

    // Wait for the updated text to appear
    await notesPanel.locator('p', { hasText: 'E2E测试笔记第一条(已修改)' }).first()
      .waitFor({ state: 'visible', timeout: TIMEOUT });
    pass('7. Edited note text visible in UI');

    // Verify update in backend
    const list3 = await api('GET', `/api/tasks/${taskId}/notes`);
    const updated = list3.body.find((n) => n.id === noteId1);
    assert.ok(updated, 'updated note not found in backend');
    assert.equal(updated.body, 'E2E测试笔记第一条(已修改)', 'updated body mismatch');
    assert.ok(updated.updatedAt >= updated.createdAt, 'updatedAt should be >= createdAt');
    pass('7. Edit persisted in backend (body + updatedAt correct)');

    // ── 8. Delete a note ─────────────────────────────────────────────────────
    // Hover over the second note to reveal the 删除 button
    const note2Li = notesPanel.locator('li', { hasText: 'E2E测试笔记第二条' }).first();
    await note2Li.waitFor({ state: 'visible' });
    await note2Li.hover();

    const deleteBtn = note2Li.locator('button', { hasText: '删除' }).first();
    await deleteBtn.waitFor({ state: 'visible', timeout: TIMEOUT });
    await deleteBtn.click();

    // Note disappears from UI
    await notesPanel.locator('p', { hasText: 'E2E测试笔记第二条' }).first()
      .waitFor({ state: 'hidden', timeout: TIMEOUT });
    pass('8. Deleted note removed from UI');

    // Verify deletion in backend
    const list4 = await api('GET', `/api/tasks/${taskId}/notes`);
    assert.equal(list4.body.length, 1, `expected 1 note after delete, got ${list4.body.length}`);
    assert.equal(list4.body.find((n) => n.id === noteId2), undefined, 'deleted note still in backend');
    pass('8. Deletion confirmed in backend (1 note remaining)');

    // ── 9. Note count shown in panel header ──────────────────────────────────
    // The header div contains "笔记" + "· 1"
    const headerDiv = notesPanel.locator('div').filter({ hasText: /笔记/ }).first();
    const headerText = await headerDiv.textContent();
    assert.ok(headerText?.includes('1'), `header should show count 1, got: "${headerText}"`);
    pass('9. Notes header reflects correct count (· 1)');

    // ── 10. Escape cancels inline edit without saving ─────────────────────────
    const remainingNotePara = notesPanel.locator('p.cursor-text').first();
    await remainingNotePara.waitFor({ state: 'visible' });
    const originalText = (await remainingNotePara.textContent()) ?? '';

    await remainingNotePara.click();
    const escapeBox = notesPanel.locator('textarea').last();
    await escapeBox.waitFor({ state: 'visible' });
    await escapeBox.fill('临时修改不应保存');
    await escapeBox.press('Escape');

    // Textarea disappears; paragraph text reverts
    const revertedPara = notesPanel.locator('p.cursor-text').first();
    await revertedPara.waitFor({ state: 'visible' });
    const revertedText = (await revertedPara.textContent()) ?? '';
    assert.equal(revertedText, originalText, `Escape should revert to "${originalText}", got "${revertedText}"`);
    pass('10. Escape cancels edit without saving (text reverted in UI)');

    // Confirm backend unchanged
    const list5 = await api('GET', `/api/tasks/${taskId}/notes`);
    const unchanged = list5.body.find((n) => n.id === noteId1);
    assert.equal(unchanged?.body, 'E2E测试笔记第一条(已修改)', 'backend should not change on Escape');
    pass('10. Backend unchanged after Escape cancel');

    // ── 11. Console error check ───────────────────────────────────────────────
    const relevantErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('404') && !e.includes('net::ERR')
        && !e.includes('MIME type') && !e.includes('EventSource')
    );
    if (relevantErrors.length === 0) {
      pass('11. No unexpected JS console errors during test');
    } else {
      fail('11. Console errors detected', relevantErrors.join('\n       '));
    }

  } finally {
    await browser.close();
    server.close();
    // ── Teardown: remove all test state ──────────────────────────────────────
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('[e2e-notes] Teardown complete — temp dir deleted, server closed');
  }

  if (process.exitCode) {
    console.error('\nFAIL e2e-notes (see above)\n');
  } else {
    console.log('\nPASS e2e-notes\n');
  }
})().catch((e) => {
  console.error('[e2e-notes] Unhandled error:', e);
  process.exit(1);
});
