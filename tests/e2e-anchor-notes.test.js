'use strict';
/**
 * E2E test: Article anchor note binding
 *
 * Covers the new selection → bubble → anchor → positioned card flow.
 * Tests that are NOT covered by e2e-notes.test.js:
 *   1. Text selection triggers bubble
 *   2. Click bubble focuses input + shows anchor preview
 *   3. Submitted note has non-empty anchor in backend
 *   4. Note card absolute top > 0 for non-first-paragraph anchor
 *   5. Two notes anchored to same paragraph → push-down (no overlap)
 *   6. Note with unresolvable anchor still renders (graceful degradation)
 *   7. Escape in textarea clears pending anchor preview
 *   8. No JS console errors
 *
 * Run:  node tests/e2e-anchor-notes.test.js
 * Or:   npm run test:e2e:anchor-notes
 * Watch: E2E_HEADED=1 node tests/e2e-anchor-notes.test.js
 */

const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');
const os     = require('node:os');
const http   = require('node:http');
const { chromium } = require('playwright');
const { createApp } = require('../services/http-server');

const TOKEN    = 'e2e-anchor-test-token';
const TIMEOUT  = 15_000;
const HEADLESS = process.env.E2E_HEADED !== '1';

// ── Helpers ──────────────────────────────────────────────────────────────────
let serverPort;
async function api(method, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${serverPort}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
  return { status: res.status, body: json };
}

/**
 * Programmatically select `targetText` inside .prose-cn and fire a native
 * mouseup on the article element so Reader's handleMouseUp picks it up.
 */
async function selectTextInArticle(page, targetText) {
  return page.evaluate((text) => {
    const article = document.querySelector('.prose-cn');
    if (!article) return false;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent ?? '').indexOf(text);
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        article.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        return true;
      }
    }
    return false;
  }, targetText);
}

function pass(msg) { console.log(`  PASS ${msg}`); }
function fail(msg, detail) {
  console.error(`  FAIL ${msg}${detail ? `\n       ${detail}` : ''}`);
  process.exitCode = 1;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  // ── Setup ─────────────────────────────────────────────────────────────────
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdl-e2e-anchor-'));

  const distSrc = path.join(__dirname, '..', 'web', 'dist');
  const distDst = path.join(tmp, 'web', 'dist');
  fs.mkdirSync(distDst, { recursive: true });
  fs.cpSync(distSrc, distDst, { recursive: true });

  const app = createApp({ rootDir: tmp, token: TOKEN, host: '127.0.0.1' });
  const server = http.createServer(app.callback()).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  serverPort = server.address().port;
  console.log(`\n[e2e-anchor] backend on :${serverPort}  (tmp: ${tmp})`);

  const createRes = await api('POST', '/api/tasks', {
    url: 'https://www.youtube.com/watch?v=e2e_anchor_test',
    mode: 'transcript',
    force: 1,
  });
  assert.equal(createRes.status, 201, `task create failed: ${JSON.stringify(createRes.body)}`);
  const taskId = createRes.body.task_id;
  console.log(`[e2e-anchor] test task: ${taskId}`);

  // Article with three distinct paragraphs — selection targets won't collide
  const writingDir = path.join(tmp, 'work', taskId, 'writing');
  fs.mkdirSync(writingDir, { recursive: true });
  fs.writeFileSync(path.join(writingDir, 'article.md'), [
    '# Anchor Test Article',
    '',
    'This is the first paragraph for anchor binding tests.',
    '',
    'This is the second paragraph used to test push-down collision of multiple notes.',
    '',
    'This is a third paragraph providing additional coverage.',
  ].join('\n'));
  fs.writeFileSync(path.join(writingDir, 'summary.md'), '## Summary\n\nAnchor test.\n');

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page    = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);

  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  try {
    await page.goto(`http://127.0.0.1:${serverPort}/tasks/${taskId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.layout-shell', { timeout: TIMEOUT });

    // Switch to 文章 tab so Reader renders with prose content
    await page.click('button:has-text("文章")');
    await page.waitForSelector('.prose-cn', { timeout: TIMEOUT });

    const notesPanel = page.locator('.notes-col').first();
    await notesPanel.waitFor({ state: 'visible' });

    // ── 1. Text selection shows bubble ────────────────────────────────────────
    const found1 = await selectTextInArticle(page, 'first paragraph');
    assert.ok(found1, '1. target text not found in article');

    await page.locator('.anchor-bubble').waitFor({ state: 'visible', timeout: TIMEOUT });
    pass('1. Bubble appears after text selection in article');

    // ── 2. Click bubble → input focused + anchor preview ─────────────────────
    await page.locator('.anchor-bubble').click();
    // Small wait for React state flush
    await page.waitForTimeout(150);

    const anchorPreview = notesPanel.locator('div', { hasText: '锚点：' }).first();
    await anchorPreview.waitFor({ state: 'visible', timeout: TIMEOUT });
    const previewText = await anchorPreview.textContent();
    assert.ok(
      previewText?.includes('first paragraph'),
      `2. anchor preview should contain "first paragraph", got: "${previewText}"`
    );
    pass('2. Anchor preview visible and contains selected text');

    const inputFocused = await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA');
    assert.ok(inputFocused, '2. textarea should be focused after bubble click');
    pass('2. Textarea is focused after bubble click');

    // ── 3. Submit → backend anchor field is non-empty ─────────────────────────
    const noteInput = notesPanel.locator('textarea').first();
    await noteInput.fill('第一条锚点笔记');
    await noteInput.press('Meta+Enter');
    await notesPanel.locator('p', { hasText: '第一条锚点笔记' }).first()
      .waitFor({ state: 'visible', timeout: TIMEOUT });
    pass('3. Anchored note appears in UI');

    const list1 = await api('GET', `/api/tasks/${taskId}/notes`);
    assert.equal(list1.status, 200);
    assert.equal(list1.body.length, 1);
    const note1 = list1.body[0];
    assert.ok(
      note1.anchor && note1.anchor.length > 0,
      `3. anchor should be non-empty, got: "${note1.anchor}"`
    );
    assert.ok(
      note1.anchor.includes('first paragraph'),
      `3. anchor should include selected text, got: "${note1.anchor}"`
    );
    pass(`3. Backend anchor field is non-empty: "${note1.anchor}"`);

    // ── 4. Note card absolute top > 0 for non-first paragraph anchor ──────────
    // Anchor to second paragraph (further down the article)
    const found2 = await selectTextInArticle(page, 'second paragraph');
    assert.ok(found2, '4. second paragraph not found');
    await page.locator('.anchor-bubble').waitFor({ state: 'visible', timeout: TIMEOUT });
    await page.locator('.anchor-bubble').click();
    await page.waitForTimeout(150);

    const noteInput2 = notesPanel.locator('textarea').first();
    await noteInput2.fill('第二段落锚点笔记');
    await noteInput2.press('Meta+Enter');
    await notesPanel.locator('p', { hasText: '第二段落锚点笔记' }).first()
      .waitFor({ state: 'visible', timeout: TIMEOUT });
    await page.waitForTimeout(200); // layout effect settles

    // The absolute `top` of a note anchored to the second paragraph must be > 0
    const noteTop = await page.evaluate(() => {
      const uls = document.querySelectorAll('.notes-col ul[style*="position: absolute"]');
      if (!uls.length) return null;
      for (const ul of uls) {
        if (ul.textContent?.includes('第二段落锚点笔记')) {
          return parseFloat(ul.style.top) || 0;
        }
      }
      return null;
    });
    assert.ok(noteTop !== null, '4. could not find anchored note card in absolute zone');
    assert.ok(noteTop > 0, `4. note card top should be > 0 for second-paragraph anchor, got ${noteTop}`);
    pass(`4. Note card absolute top=${noteTop}px > 0 (second paragraph positioned below top)`);

    // ── 5. Two notes on same anchor → push-down, no overlap ──────────────────
    // Add another note anchored to the SAME second paragraph
    const found3 = await selectTextInArticle(page, 'second paragraph');
    assert.ok(found3, '5. second paragraph not found (second time)');
    await page.locator('.anchor-bubble').waitFor({ state: 'visible', timeout: TIMEOUT });
    await page.locator('.anchor-bubble').click();
    await page.waitForTimeout(150);

    const noteInput3 = notesPanel.locator('textarea').first();
    await noteInput3.fill('同段落第二条笔记');
    await noteInput3.press('Meta+Enter');
    await notesPanel.locator('p', { hasText: '同段落第二条笔记' }).first()
      .waitFor({ state: 'visible', timeout: TIMEOUT });
    await page.waitForTimeout(300); // layout effect + ResizeObserver settle

    const noOverlap = await page.evaluate(() => {
      const uls = Array.from(document.querySelectorAll(
        '.notes-col ul[style*="position: absolute"]'
      )).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
      if (uls.length < 2) return { ok: false, reason: `only ${uls.length} card(s) in absolute zone` };
      // Compare adjacent cards by their style.top + offsetHeight
      for (let i = 1; i < uls.length; i++) {
        const prev = uls[i - 1];
        const curr = uls[i];
        const prevTop    = parseFloat(prev.style.top) || 0;
        const prevHeight = prev.offsetHeight;
        const currTop    = parseFloat(curr.style.top) || 0;
        if (currTop < prevTop + prevHeight) {
          return { ok: false, reason: `cards ${i-1} and ${i} overlap: prevTop=${prevTop} prevH=${prevHeight} currTop=${currTop}` };
        }
      }
      return { ok: true, reason: 'all clear' };
    });
    assert.ok(noOverlap.ok, `5. push-down failed: ${noOverlap.reason}`);
    pass('5. Push-down: anchored note cards do not overlap');

    // ── 6. Note with unresolvable anchor still renders (graceful degradation) ──
    await api('POST', `/api/tasks/${taskId}/notes`, {
      body: '幽灵锚点笔记',
      anchor: '这段文字根本不存在于文章中_xyz_sentinel',
    });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('.layout-shell', { timeout: TIMEOUT });
    await page.click('button:has-text("文章")');
    await page.waitForSelector('.prose-cn', { timeout: TIMEOUT });
    await page.waitForTimeout(500);

    const ghostVisible = await notesPanel.locator('p', { hasText: '幽灵锚点笔记' }).first().isVisible();
    assert.ok(ghostVisible, '6. note with unresolvable anchor should still render');
    pass('6. Note with unresolvable anchor renders without crashing');

    // ── 7. Escape in textarea clears pending anchor preview ───────────────────
    const found4 = await selectTextInArticle(page, 'third paragraph');
    assert.ok(found4, '7. third paragraph not found');
    await page.locator('.anchor-bubble').waitFor({ state: 'visible', timeout: TIMEOUT });
    await page.locator('.anchor-bubble').click();
    await page.waitForTimeout(150);

    // Confirm preview appeared
    await notesPanel.locator('div', { hasText: '锚点：' }).first()
      .waitFor({ state: 'visible', timeout: TIMEOUT });

    // Press Escape in the textarea
    await notesPanel.locator('textarea').first().press('Escape');
    await page.waitForTimeout(150);

    const previewCount = await notesPanel.locator('div', { hasText: '锚点：' }).count();
    assert.equal(previewCount, 0, '7. anchor preview should be gone after Escape');
    pass('7. Escape in textarea clears pending anchor preview');

    // ── 8. Console error check ────────────────────────────────────────────────
    const relevantErrors = consoleErrors.filter(
      (e) => !e.includes('favicon') && !e.includes('404') && !e.includes('net::ERR')
        && !e.includes('MIME type') && !e.includes('EventSource')
    );
    if (relevantErrors.length === 0) {
      pass('8. No unexpected JS console errors');
    } else {
      fail('8. Console errors detected', relevantErrors.join('\n       '));
    }

  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('[e2e-anchor] Teardown complete — temp dir deleted, server closed');
  }

  if (process.exitCode) {
    console.error('\nFAIL e2e-anchor-notes (see above)\n');
  } else {
    console.log('\nPASS e2e-anchor-notes\n');
  }
})().catch((e) => {
  console.error('[e2e-anchor] Unhandled error:', e);
  process.exit(1);
});
