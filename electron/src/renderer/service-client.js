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
      const msg = (data && data.error && data.error.message) || (data && data.error) || (data && data.message) || res.statusText;
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

  getTaskSteps(taskId) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/steps`);
  }

  runStep(taskId, stepName, { focus, force } = {}) {
    return this._fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/steps/${encodeURIComponent(stepName)}/run`, {
      method: 'POST',
      body: JSON.stringify({ focus, force })
    });
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

