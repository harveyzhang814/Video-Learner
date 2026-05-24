'use strict';

const assert = require('assert');
const { deriveUiState, deriveInfoTabDot } = require('../electron/src/renderer/ui-state');

async function run() {
  // U8: empty state
  const empty = deriveUiState({ tasks: [], selectedTaskId: null });
  assert.strictEqual(empty.isEmpty, true);
  assert.strictEqual(empty.selectedTask, null);
  assert.strictEqual(empty.tasks.length, 0);
  console.log('U8 empty state: ok');

  // U2: list + selected task
  const tasks = [
    { task_id: 't1', status: 'completed', meta: { url: 'https://a.com' } },
    { task_id: 't2', status: 'running', meta: { url: 'https://b.com' } }
  ];
  const withSelection = deriveUiState({ tasks, selectedTaskId: 't2' });
  assert.strictEqual(withSelection.isEmpty, false);
  assert.strictEqual(withSelection.selectedTask.task_id, 't2');
  assert.strictEqual(withSelection.selectedTask.meta.url, 'https://b.com');
  console.log('U2 selected task: ok');

  // U1/U3: list from listTasks() shapes first screen
  const fromList = deriveUiState({ tasks, selectedTaskId: null });
  assert.strictEqual(fromList.tasks.length, 2);
  assert.strictEqual(fromList.selectedTask, null);
  console.log('U1/U3 list state: ok');

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

  console.log('gui-logic-state.test.js: all passed');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
