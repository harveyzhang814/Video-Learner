/**
 * Pure state reducer for GUI task/step/log state driven by SSE events.
 * No DOM; used by tests and renderer logic.
 */

function defaultStepState() {
  return { status: 'pending', attempts: 0, error: null };
}

function reduceTaskState(state, event) {
  if (!event || !event.type) return state;
  const next = { ...state, needsResync: state.needsResync || false };
  const { type, taskId, payload = {} } = event;

  if (type === 'stream.resync_required') {
    next.needsResync = true;
    return next;
  }

  if (type === 'task.created' || type === 'task.updated') {
    next.tasks = next.tasks || {};
    const existing = next.tasks[taskId] || { taskId, steps: {}, logs: [] };
    next.tasks[taskId] = { ...existing, ...payload, taskId };
    return next;
  }

  if (type === 'step.started') {
    const stepName = payload.stepName || payload.name;
    if (taskId && stepName) {
      next.tasks = next.tasks || {};
      const task = next.tasks[taskId] || { taskId, steps: {}, logs: [] };
      task.steps = task.steps || {};
      task.steps[stepName] = { status: 'running', attempts: payload.attempts ?? 1, error: null };
      next.tasks[taskId] = { ...task };
    }
    return next;
  }

  if (type === 'step.finished' || type === 'step.failed') {
    const stepName = payload.stepName || payload.name;
    const status = type === 'step.failed' ? 'failed'
      : (payload.aborted ? 'pending' : 'completed');
    if (taskId && stepName) {
      next.tasks = next.tasks || {};
      const task = next.tasks[taskId] || { taskId, steps: {}, logs: [] };
      task.steps = task.steps || {};
      task.steps[stepName] = { status, attempts: payload.attempts ?? 1, error: payload.error || null };
      next.tasks[taskId] = { ...task };
    }
    return next;
  }

  if (type === 'log.appended') {
    const { seq, line, level } = payload;
    if (taskId != null && (seq != null || line != null)) {
      next.tasks = next.tasks || {};
      const task = next.tasks[taskId] || { taskId, steps: {}, logs: [] };
      const logs = [...(task.logs || [])];
      const existing = logs.find((l) => l.seq === seq);
      if (!existing) {
        logs.push({ seq: seq ?? logs.length, line: line ?? '', level: level || 'info' });
        logs.sort((a, b) => (a.seq != null && b.seq != null ? a.seq - b.seq : 0));
      }
      next.tasks[taskId] = { ...task, logs };
    }
    return next;
  }

  return next;
}

module.exports = { reduceTaskState, defaultStepState };
