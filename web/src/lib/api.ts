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

// ── Backend response shapes (real API) ──────────────────────────────────────

interface BackendListTask {
  id: string; url: string; title?: string; uploader?: string;
  duration?: string; mode?: string; output_lang?: string; focus?: string;
  created_at?: string; updated_at?: string;
}

interface BackendTask {
  task_id: string;
  status?: string;
  meta?: {
    url?: string; title?: string; uploader?: string; duration?: string;
    output_lang?: string; focus?: string; mode?: string;
    ts?: string; created_at?: string;
    transcript_done?: boolean; article_done?: boolean; summary_done?: boolean;
    download_status?: string;
  };
}

function parseDateStr(s?: string): number {
  if (!s) return Date.now();
  return new Date(s.includes('T') ? s : s.replace(' ', 'T')).getTime();
}

function mapMode(raw?: string): TaskMode {
  if (raw === 'audio') return 'audio';
  if (raw === 'transcript') return 'transcript';
  if (raw === 'both' || raw === 'full') return 'full';
  return 'media';
}

function mapStatus(raw?: string): TaskStatus {
  if (raw === 'completed') return 'done';
  if (raw === 'running' || raw === 'pending' || raw === 'failed' || raw === 'canceled') return raw;
  return 'done';
}

function normalizeListTask(t: BackendListTask): Task {
  return {
    id: t.id,
    url: t.url,
    title: t.title,
    uploader: t.uploader,
    duration_seconds: t.duration ? parseInt(t.duration, 10) || undefined : undefined,
    mode: mapMode(t.mode),
    output_lang: t.output_lang,
    focus: t.focus ?? undefined,
    status: 'done',
    created_at: parseDateStr(t.created_at),
    updated_at: parseDateStr(t.updated_at),
  };
}

function normalizeTask(raw: BackendTask): Task {
  const m = raw.meta ?? {};
  return {
    id: raw.task_id,
    url: m.url ?? '',
    title: m.title,
    uploader: m.uploader,
    duration_seconds: m.duration ? parseInt(m.duration, 10) || undefined : undefined,
    mode: mapMode(m.mode),
    output_lang: m.output_lang,
    focus: m.focus ?? undefined,
    status: mapStatus(raw.status),
    created_at: parseDateStr(m.ts ?? m.created_at),
    updated_at: parseDateStr(m.ts ?? m.created_at),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface MediaInfo {
  video: { exists: boolean };
  audio: { exists: boolean };
}

export const api = {
  listTasks: async (_limit = 200): Promise<{ tasks: Task[] }> => {
    const raw = await request<BackendListTask[]>(`/api/tasks`);
    return { tasks: Array.isArray(raw) ? raw.map(normalizeListTask) : [] };
  },
  getTask: async (id: string): Promise<{ task: Task }> => {
    const raw = await request<BackendTask>(`/api/tasks/${id}`);
    return { task: normalizeTask(raw) };
  },
  getMediaInfo: (id: string) => request<MediaInfo>(`/api/tasks/${id}/media`),
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
