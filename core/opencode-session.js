'use strict';

async function createOpencodeSession(port) {
  const resolvedPort = port ?? Number(process.env.OPENCODE_PORT ?? 4097);
  const url = `http://127.0.0.1:${resolvedPort}/session`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'video-learner-writing' }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (typeof json.id === 'string' && json.id) ? json.id : null;
  } catch (_) {
    return null;
  }
}

async function isOpencodeSessionUsable(sessionId, port) {
  if (!sessionId) return false;
  const resolvedPort = port ?? Number(process.env.OPENCODE_PORT ?? 4097);
  const url = `http://127.0.0.1:${resolvedPort}/session/${encodeURIComponent(sessionId)}/message`;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const json = await res.json();
    return Array.isArray(json) && json.length > 0;
  } catch (_) {
    return false;
  }
}

module.exports = { createOpencodeSession, isOpencodeSessionUsable };
