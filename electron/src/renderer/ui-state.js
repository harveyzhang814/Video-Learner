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

module.exports = { deriveUiState };
