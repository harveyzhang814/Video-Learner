'use strict';

const assert = require('assert');
const { deriveUiState } = require('../electron/src/renderer/ui-state');

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

  console.log('gui-logic-state.test.js: all passed');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
