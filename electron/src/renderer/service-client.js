// Minimal HTTP + SSE client for renderer (no IPC/WS).
// Expects renderer preload exposes: window.service.getServiceInfo() => { baseUrl, token }

export class ServiceClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.token = token || '';
  }

  _headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      ...extra
    };
  }

  async _fetchJson(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: this._headers({
        'Content-Type': 'application/json',
        ...(options.headers || {})
      })
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = text;
    }
    if (!res.ok) {
      const msg =
        (data && data.error && data.error.message) ||
        (data && data.error) ||
        (data && data.message) ||
        (data && data.output) ||
        res.statusText;
      throw new Error(`${res.status} ${msg}`);
    }
    return data;
  }

  listTasks({ limit = 200 } = {}) {
    return this._fetchJson(`/api/tasks?limit=${encodeURIComponent(String(limit))}`);
  }

  createTask({ url, focus, mode = 'both', force = false, output_lang } = {}) {
    return this._fetchJson('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ url, focus, mode, force, output_lang })
    });
  }

  getTask(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}`);
  }

  getTaskMedia(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/media`);
  }

  getTaskSubtitles(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/subtitles`);
  }

  async getTaskContent(taskId, type) {
    if (type !== 'article' && type !== 'summary') {
      throw new Error('type must be article or summary');
    }
    const url = `${this.baseUrl}/api/tasks/${encodeURIComponent(taskId)}/result/content?type=${encodeURIComponent(type)}`;
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) {
      const text = await res.text();
      let msg = res.statusText;
      try {
        const data = JSON.parse(text);
        if (data && data.error) msg = data.error;
      } catch (_) {
        // ignore
      }
      throw new Error(`${res.status} ${msg}`);
    }
    return await res.text();
  }

  getTaskSteps(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/steps`);
  }

  runStep(taskId, stepName, { focus, force, reset_scope } = {}) {
    const body = {};
    if (focus !== undefined) body.focus = focus;
    if (force !== undefined) body.force = force;
    if (reset_scope !== undefined) body.reset_scope = reset_scope;
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/steps/${encodeURIComponent(stepName)}/run`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  deleteTask(taskId, { mode = 'hard' } = {}) {
    const q = new URLSearchParams({ mode }).toString();
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}?${q}`, { method: 'DELETE' });
  }

  cancelTask(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
  }

  resumeTask(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/resume`, { method: 'POST' });
  }

  cancelStep(taskId, stepName) {
    return this._fetchJson(
      `/api/tasks/${encodeURIComponent(taskId)}/steps/${encodeURIComponent(stepName)}/cancel`,
      { method: 'POST' }
    );
  }

  subscribeEvents({ lastEventId } = {}) {
    const url = new URL(`${this.baseUrl}/api/events`);
    url.searchParams.set('token', this.token);
    const es = new EventSource(url.toString(), {
      withCredentials: false
    });
    if (lastEventId) {
      // EventSource doesn't allow setting Last-Event-Id header directly.
      // We'll store lastEventId in-memory; server-side replay will require browser to send header on reconnect.
      // Some browsers do it automatically; renderer (Chromium) generally does.
    }
    return es;
  }
}

