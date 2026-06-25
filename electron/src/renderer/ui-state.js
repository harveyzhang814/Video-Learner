/**
 * Derive UI-facing state from raw tasks list and selection.
 * No DOM; used by tests and renderer for U1/U2/U8 empty state etc.
 */

function deriveUiState({ tasks = [], selectedTaskId = null }) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const selectedTask = taskList.find((t) => t.task_id === selectedTaskId) || null;
  return {
    isEmpty: taskList.length === 0,
    tasks: taskList,
    selectedTaskId: selectedTaskId || null,
    selectedTask
  };
}

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

module.exports = { deriveUiState, deriveInfoTabDot };
