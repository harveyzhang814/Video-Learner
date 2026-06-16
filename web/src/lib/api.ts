function readToken(): string {
  const el = document.querySelector('meta[name="vdl-token"]');
  return el?.getAttribute('content') ?? '';
}

const TOKEN = readToken();

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

async function request<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (TOKEN) headers.set('Authorization', `Bearer ${TOKEN}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(input, { ...init, headers });
  if (!res.ok) {
    let detail: Json = null;
    try { detail = await res.json(); } catch {}
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(detail)}`);
  }
  return res.status === 204 ? (undefined as T) : (await res.json() as T);
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';
export type TaskMode = 'media' | 'audio' | 'transcript' | 'full';

export interface Task {
  id: string;
  url: string;
  title?: string;
  uploader?: string;
  duration_seconds?: number;
  mode: TaskMode;
  output_lang?: string;
  focus?: string;
  status: TaskStatus;
  progress?: number;
  current_step?: string;
  error_message?: string;
  created_at: number;
  updated_at: number;
}

export interface Step {
  name: string;
  status: TaskStatus;
  started_at?: number;
  finished_at?: number;
  error_message?: string;
}

export const api = {
  listTasks: (limit = 200) => request<{ tasks: Task[] }>(`/api/tasks?limit=${limit}`),
  getTask:   (id: string) => request<{ task: Task }>(`/api/tasks/${id}`),
  getSteps:  (id: string) => request<{ steps: Step[] }>(`/api/tasks/${id}/steps`),
  getContent:(id: string, type: 'summary' | 'article' | 'transcript') =>
    fetch(`/api/tasks/${id}/result/content?type=${type}`, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}
    }).then((r) => r.ok ? r.text() : ''),
  cancel:  (id: string) => request<{ ok: true }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  resume:  (id: string) => request<{ ok: true }>(`/api/tasks/${id}/resume`, { method: 'POST' }),
  remove:  (id: string, reset_scope: 'off' | 'step' | 'downstream' = 'off') =>
    request<{ ok: true }>(`/api/tasks/${id}?reset_scope=${reset_scope}`, { method: 'DELETE' }),
  reveal:  (id: string) => request<{ ok: true }>(`/api/tasks/${id}/reveal`, { method: 'POST' }),
  runStep: (id: string, step: string) =>
    request<{ ok: true }>(`/api/tasks/${id}/steps/${step}/run`, { method: 'POST' }),
  cancelStep: (id: string, step: string) =>
    request<{ ok: true }>(`/api/tasks/${id}/steps/${step}/cancel`, { method: 'POST' }),
  token: () => TOKEN
};
