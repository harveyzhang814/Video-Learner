import { api } from './api';

export type SSEEvent =
  | { type: 'task.created'; taskId: string }
  | { type: 'task.update';  taskId: string }
  | { type: 'task.deleted'; taskId: string }
  | { type: 'step.update';  taskId: string; step: string }
  | { type: 'heartbeat' };

export function openEventStream(onEvent: (e: SSEEvent) => void): () => void {
  const token = api.token();
  const url = `/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const es = new EventSource(url);
  es.onmessage = (m) => {
    try {
      const parsed = JSON.parse(m.data);
      onEvent(parsed as SSEEvent);
    } catch (err) {
      console.warn('[sse] parse error', err);
    }
  };
  es.onerror = (err) => {
    console.warn('[sse] error', err);
  };
  return () => es.close();
}
