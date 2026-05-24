# Progress Display Migration: Main Area → Info Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move progress display from the main content area (`#progressSection` horizontal bar) to the right-side info panel as status pills, with a tab dot indicator on the 「信息」tab.

**Architecture:** Three coordinated changes in `electron/src/renderer/index.html` (remove old HTML+CSS, add tab dot HTML+CSS, wire JS logic) plus a pure derivation function in `ui-state.js` for testability. Two doc-sync tasks close out.

**Tech Stack:** Electron renderer (HTML/CSS/JS), no external dependencies. Tests: plain Node.js (`node tests/gui-logic-state.test.js`).

---

## File Map

| File | Change |
|---|---|
| `electron/src/renderer/index.html` | Remove `#progressSection` DOM + CSS; add `.tab-status-dot` HTML + CSS; add `updateInfoTabDot()` JS function and its call sites |
| `electron/src/renderer/ui-state.js` | Add `deriveInfoTabDot(steps)` pure function |
| `tests/gui-logic-state.test.js` | Add tests for `deriveInfoTabDot` |
| `DESIGN.md` | Update §5.3 to remove progress bar entries, add tab dot behavior |
| `docs/reference/design-previews/app-renderer-design.html` | Update state 3 (running) mockup: remove progress bar, add tab dot |

---

## Task 1: Remove `#progressSection` HTML block

**Files:**
- Modify: `electron/src/renderer/index.html:1618-1632`

- [ ] **Step 1: Delete the `#progressSection` DOM block**

In `electron/src/renderer/index.html`, find and delete this entire block (after the `.tabs` div, before `</div>` that closes `.content-card-header`):

```html
            <div class="progress-section hidden" id="progressSection">
              <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: 0%"></div>
              </div>
              <div class="progress-steps">
                <div class="progress-step" data-step="fetch"><span class="dot"></span>获取</div>
                <div class="progress-step" data-step="video"><span class="dot"></span>视频</div>
                <div class="progress-step" data-step="audio"><span class="dot"></span>音频</div>
                <div class="progress-step" data-step="subs"><span class="dot"></span>字幕</div>
                <div class="progress-step" data-step="vtt2md"><span class="dot"></span>转文案</div>
                <div class="progress-step" data-step="md2vtt"><span class="dot"></span>字幕生成</div>
                <div class="progress-step" data-step="article"><span class="dot"></span>文章</div>
                <div class="progress-step" data-step="summary"><span class="dot"></span>摘要</div>
              </div>
            </div>
```

After deletion, the `.content-card-header` div should end immediately after the `.tabs` div:

```html
            <div class="content-card-header" id="contentCardHeader">
              <div class="tabs" role="tablist">
                <div class="tab active" role="tab" ...>文章</div>
                <div class="tab" role="tab" ...>摘要</div>
              </div>
            </div>
```

- [ ] **Step 2: Delete the Progress Bar CSS block**

In `electron/src/renderer/index.html`, find and delete this entire CSS section (the comment `/* Progress Bar */` through the closing `}` of `@keyframes pulse`):

```css
    /* Progress Bar */
    .progress-section {
      margin-bottom: calc(var(--grid-unit) * 2);
    }

    .progress-bar {
      height: 3px;
      background: var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: var(--accent);
      transition: width 0.3s ease;
    }

    .progress-steps {
      display: flex;
      gap: calc(var(--grid-unit) * 2);
      margin-top: 8px;
    }

    .progress-step {
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .progress-step.active {
      color: var(--text);
      font-weight: 500;
    }

    .progress-step.done {
      color: var(--text);
    }

    .progress-step .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--border);
    }

    .progress-step.active .dot {
      background: var(--accent);
      animation: pulse 1s infinite;
    }

    .progress-step.done .dot {
      background: var(--accent);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
```

Note: `@keyframes pulse` will be re-added in Task 2 scoped to the new tab dot.

- [ ] **Step 3: Verify the renderer still loads (visual check)**

```bash
cd /Users/harveyzhang96/Projects/Video-Learner
npm run test:gui
```

Expected: tests pass. The `#progressSection` is gone and nothing references it from JS (confirmed: no JS logic was wired to it).

- [ ] **Step 4: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "refactor(gui): remove #progressSection from main content area

Progress bar and step dots no longer shown in main content area.
JS had no live wiring to #progressSection so no JS changes needed.
@keyframes pulse removed here; will be re-added for tab dot in next commit."
```

---

## Task 2: Add tab status dot HTML + CSS

**Files:**
- Modify: `electron/src/renderer/index.html`

- [ ] **Step 1: Add the dot span to the 「信息」tab button**

Find this line in `electron/src/renderer/index.html` (inside `#panelTabs`):

```html
        <button class="panel-tab" role="tab" aria-selected="false" aria-controls="infoPane" data-panel="info">信息</button>
```

Replace with:

```html
        <button class="panel-tab" role="tab" aria-selected="false" aria-controls="infoPane" data-panel="info">信息<span class="tab-status-dot hidden" id="infoTabDot"></span></button>
```

- [ ] **Step 2: Add CSS for the tab dot**

In `electron/src/renderer/index.html`, find the `/* Panel Tabs */` CSS section (around the `.panel-tab` rules). After the last `.panel-tab` rule block, add:

```css
    /* Info tab status dot */
    .tab-status-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-left: 5px;
      vertical-align: middle;
      position: relative;
      top: -1px;
    }

    .tab-status-dot.running {
      background: #FFD700;
      animation: pulse 1.4s infinite;
    }

    .tab-status-dot.error {
      background: #EF4444;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }
```

- [ ] **Step 3: Run GUI tests**

```bash
npm run test:gui
```

Expected: passes. The dot is hidden by default (`.hidden` class).

- [ ] **Step 4: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): add tab-status-dot to 信息 tab

Hidden by default. CSS-only in this commit; JS wiring in next task.
States: .running (yellow pulse) / .error (red static) / .hidden (default)."
```

---

## Task 3: Add `deriveInfoTabDot` to `ui-state.js` + tests

**Files:**
- Modify: `electron/src/renderer/ui-state.js`
- Modify: `tests/gui-logic-state.test.js`

- [ ] **Step 1: Add `deriveInfoTabDot` to `ui-state.js`**

Open `electron/src/renderer/ui-state.js`. After the `deriveUiState` function, add:

```js
/**
 * Derive the state of the info-tab status dot from a task's steps object.
 * steps: { [stepName]: { status: 'pending'|'running'|'completed'|'skipped'|'failed' } }
 * Returns: 'running' | 'error' | 'hidden'
 */
function deriveInfoTabDot(steps = {}) {
  const values = Object.values(steps);
  if (values.some((s) => s.status === 'running')) return 'running';
  if (values.some((s) => s.status === 'failed')) return 'error';
  return 'hidden';
}
```

Update `module.exports`:

```js
module.exports = { deriveUiState, deriveInfoTabDot };
```

- [ ] **Step 2: Write tests in `tests/gui-logic-state.test.js`**

Open `tests/gui-logic-state.test.js`. Update the require line and add test cases before the final `console.log`:

```js
const { deriveUiState, deriveInfoTabDot } = require('../electron/src/renderer/ui-state');
```

Add before the `run()` call's closing brace, after the existing assertions:

```js
  // Tab dot: no steps → hidden
  assert.strictEqual(deriveInfoTabDot({}), 'hidden');
  console.log('tab-dot no steps: ok');

  // Tab dot: all completed → hidden
  assert.strictEqual(deriveInfoTabDot({
    fetch: { status: 'completed' },
    video: { status: 'completed' },
  }), 'hidden');
  console.log('tab-dot all done: ok');

  // Tab dot: one running → running (even if others failed)
  assert.strictEqual(deriveInfoTabDot({
    fetch: { status: 'completed' },
    video: { status: 'running' },
    audio: { status: 'failed' },
  }), 'running');
  console.log('tab-dot running: ok');

  // Tab dot: failed but no running → error
  assert.strictEqual(deriveInfoTabDot({
    fetch: { status: 'completed' },
    video: { status: 'failed' },
  }), 'error');
  console.log('tab-dot error: ok');

  // Tab dot: skipped counts as done (not error)
  assert.strictEqual(deriveInfoTabDot({
    fetch: { status: 'completed' },
    video: { status: 'skipped' },
  }), 'hidden');
  console.log('tab-dot skipped is hidden: ok');
```

- [ ] **Step 3: Run the tests to confirm they pass**

```bash
node tests/gui-logic-state.test.js
```

Expected output:
```
U8 empty state: ok
U2 selected task: ok
U1/U3 list state: ok
tab-dot no steps: ok
tab-dot all done: ok
tab-dot running: ok
tab-dot error: ok
tab-dot skipped is hidden: ok
gui-logic-state.test.js: all passed
```

- [ ] **Step 4: Commit**

```bash
git add electron/src/renderer/ui-state.js tests/gui-logic-state.test.js
git commit -m "feat(ui-state): add deriveInfoTabDot pure function + tests

Returns 'running' | 'error' | 'hidden' from task steps object.
Priority: running > error > hidden."
```

---

## Task 4: Wire `updateInfoTabDot` into the renderer

**Files:**
- Modify: `electron/src/renderer/index.html` (JS section)

The renderer uses ESM (`import { ServiceClient } from './service-client.js'`) but `ui-state.js` is CommonJS — they can't be mixed. Inline the same 3-line logic directly in the renderer script.

- [ ] **Step 1: Add `updateInfoTabDot` function**

In `electron/src/renderer/index.html`, find the `function setPillState(...)` definition (around line 2138). Immediately **after** the closing `}` of `setPillState`, add:

```js
    function updateInfoTabDot(steps) {
      const dot = document.getElementById('infoTabDot');
      if (!dot) return;
      const values = Object.values(steps || {});
      const state = values.some((s) => s.status === 'running')
        ? 'running'
        : values.some((s) => s.status === 'failed')
          ? 'error'
          : 'hidden';
      dot.classList.remove('running', 'error', 'hidden');
      dot.classList.add(state);
    }
```

- [ ] **Step 2: Call `updateInfoTabDot` inside `applyTaskToInfo`**

Find the end of `function applyTaskToInfo(task)`. The function ends after the steps `for` loop and the pill error-handling block (around line 2204). The last line before the closing `}` is:

```js
      }
    }
```

Add the call immediately before the final `}` of `applyTaskToInfo`:

```js
      const taskSteps = task && task.steps ? task.steps : {};
      updateInfoTabDot(taskSteps);
    }
```

The full end of `applyTaskToInfo` should look like:

```js
        if (pill) {
          if (ui === 'error') {
            pill.classList.add('clickable');
            pill.setAttribute('title', '重试');
            let hint = pill.querySelector('.retry-hint');
            if (!hint) {
              hint = document.createElement('span');
              hint.className = 'retry-hint';
              hint.textContent = '重试';
              pill.appendChild(hint);
            }
          } else {
            pill.classList.remove('clickable');
            pill.removeAttribute('title');
            const hint = pill.querySelector('.retry-hint');
            if (hint) hint.remove();
          }
        }
      }
      const taskSteps = task && task.steps ? task.steps : {};
      updateInfoTabDot(taskSteps);
    }
```

- [ ] **Step 3: Reset dot when task is deleted / deselected**

Find the delete handler's pill-reset line (around line 3247):

```js
      ['fetch', 'video', 'audio', 'subs', 'vtt2md', 'md2vtt', 'article', 'summary'].forEach((s) => setPillState('#infoStatus', s, {}));
```

Add the dot reset immediately after it:

```js
      ['fetch', 'video', 'audio', 'subs', 'vtt2md', 'md2vtt', 'article', 'summary'].forEach((s) => setPillState('#infoStatus', s, {}));
      updateInfoTabDot({});
```

- [ ] **Step 4: Run GUI tests**

```bash
npm run test:gui
```

Expected: passes.

- [ ] **Step 5: Manual smoke test (optional but recommended)**

```bash
bash start-electron.sh
```

Start a task and watch the 「信息」tab — a yellow pulsing dot should appear beside the label. After completion it should disappear.

- [ ] **Step 6: Commit**

```bash
git add electron/src/renderer/index.html
git commit -m "feat(gui): wire updateInfoTabDot into renderer

- updateInfoTabDot() added after setPillState()
- Called at end of applyTaskToInfo() — covers task select + SSE updates
- Called with {} in delete handler to clear dot on deselect
- Dot shows: running (yellow pulse) / failed (red) / done or empty (hidden)"
```

---

## Task 5: Update DESIGN.md §5.3

**Files:**
- Modify: `DESIGN.md`

- [ ] **Step 1: Replace §5.3 table to remove old entries and add tab dot**

Find this block in `DESIGN.md`:

```markdown
| UI 元素 | 状态 |
|---|---|
| `#progressSection` | 显示 |
| `#progressFill` | 宽度按完成步骤比例更新 |
| `.progress-step` | `active`（脉冲点）/ `done`（实心点）/ 默认（空心点） |
| 工具栏「中止」 | 显示（红色危险按钮） |
| 侧栏状态点 | 黄色 |
| 信息面板 status pill | `active` ◐ / `done` ✓ / `error` ✗（可点击重试） |
```

Replace with:

```markdown
| UI 元素 | 状态 |
|---|---|
| 工具栏「中止」 | 显示（红色危险按钮） |
| 侧栏状态点 | 黄色 |
| 信息面板 status pill | `active` ◐ / `done` ✓ / `error` ✗（可点击重试） |
| 「信息」tab 状态点（`#infoTabDot`） | 运行中：黄色脉冲 / 有失败：红色静止 / 完成或空：隐藏 |
```

- [ ] **Step 2: Commit**

```bash
git add DESIGN.md
git commit -m "docs(design): update §5.3 running state — remove #progressSection, add tab dot"
```

---

## Task 6: Update design preview running state mockup

**Files:**
- Modify: `docs/reference/design-previews/app-renderer-design.html`

- [ ] **Step 1: Update state 3 (running) — remove progress bar HTML**

In `docs/reference/design-previews/app-renderer-design.html`, find the state 3 block (comment `状态 3：running`). Inside `.content-card-header`, remove the `.progress-section` div:

```html
              <!-- Progress Section visible during running -->
              <div class="progress-section">
                <div class="progress-bar">
                  <div class="progress-fill" style="width: 62.5%"></div>
                </div>
                <div class="progress-steps">
                  <div class="progress-step done"><span class="dot"></span>获取</div>
                  <div class="progress-step done"><span class="dot"></span>视频</div>
                  <div class="progress-step done"><span class="dot"></span>音频</div>
                  <div class="progress-step done"><span class="dot"></span>字幕</div>
                  <div class="progress-step done"><span class="dot"></span>转文案</div>
                  <div class="progress-step active"><span class="dot"></span>字幕生成</div>
                  <div class="progress-step"><span class="dot"></span>文章</div>
                  <div class="progress-step"><span class="dot"></span>摘要</div>
                </div>
              </div>
```

Delete it entirely.

- [ ] **Step 2: Add tab dot to state 3's 「信息」tab button**

In state 3's video panel, find:

```html
          <button class="panel-tab active">播放</button>
          <button class="panel-tab">信息</button>
```

Replace with:

```html
          <button class="panel-tab active">播放</button>
          <button class="panel-tab">信息<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#FFD700;margin-left:5px;vertical-align:middle;position:relative;top:-1px;animation:pulse 1.4s infinite;"></span></button>
```

Also add `@keyframes pulse` to the `<style>` block in the preview file if not already present (search for it — if absent, add after the existing `@keyframes` rules):

```css
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }
```

- [ ] **Step 3: Update the state 3 label**

Find the state 3 label:

```html
    <span class="state-name">running — 任务运行中，进度条 + 中止按钮</span>
```

Replace with:

```html
    <span class="state-name">running — 任务运行中，中止按钮 + 信息 tab 状态点</span>
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/design-previews/app-renderer-design.html
git commit -m "docs(design-preview): update running state mockup — remove progress bar, add tab dot"
```

---

## Completion Checklist

- [ ] `npm run test:gui` passes
- [ ] `node tests/gui-logic-state.test.js` passes (all 8 assertions including new tab-dot cases)
- [ ] Running a task shows yellow pulsing dot on 「信息」tab
- [ ] Completing a task hides the dot
- [ ] A failed step (with no active steps) shows red static dot
- [ ] Deleting a task clears the dot
- [ ] DESIGN.md §5.3 no longer references `#progressSection`
- [ ] Design preview state 3 has no progress bar
