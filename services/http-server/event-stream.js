'use strict';

const { EventEmitter } = require('events');

function nowIso() {
  return new Date().toISOString();
}

function safeJsonStringify(obj) {
  // SSE data must be on a single "data:" line for our framing; escape newlines.
  return JSON.stringify(obj).replace(/\r?\n/g, '\\n');
}

class RingBuffer {
  constructor(maxSize = 500) {
    this.maxSize = Math.max(1, maxSize);
    this.items = [];
    this.nextId = 1;
  }

  push(type, taskId, payload) {
    const event = {
      eventId: String(this.nextId++),
      type,
      taskId: taskId || null,
      ts: nowIso(),
      payload: payload || {}
    };

    this.items.push(event);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
    return event;
  }

  getWindow() {
    if (this.items.length === 0) return { minId: null, maxId: null };
    return { minId: this.items[0].eventId, maxId: this.items[this.items.length - 1].eventId };
  }

  /**
   * Return events with id > lastEventId (numeric compare).
   */
  getAfter(lastEventId) {
    const last = Number(lastEventId);
    if (!Number.isFinite(last)) return [];
    return this.items.filter((e) => Number(e.eventId) > last);
  }
}

class EventStream {
  constructor({ maxBufferSize = 500 } = {}) {
    this.buffer = new RingBuffer(maxBufferSize);
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
  }

  append({ type, taskId, payload }) {
    const ev = this.buffer.push(type, taskId, payload);
    this.emitter.emit('event', ev);
    return ev;
  }

  onEvent(handler) {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  getReplaySince(lastEventId) {
    const { minId, maxId } = this.buffer.getWindow();
    if (minId == null || maxId == null) {
      return { ok: true, events: [], minId: null, maxId: null };
    }

    const last = Number(lastEventId);
    const min = Number(minId);
    const max = Number(maxId);
    if (!Number.isFinite(last)) {
      return { ok: true, events: [], minId, maxId };
    }

    if (last < min - 1) {
      return { ok: false, reason: 'buffer_missed', minId, maxId };
    }

    return { ok: true, events: this.buffer.getAfter(lastEventId), minId, maxId };
  }

  static formatSseFrame(ev) {
    const data = safeJsonStringify({
      eventId: ev.eventId,
      type: ev.type,
      taskId: ev.taskId,
      ts: ev.ts,
      payload: ev.payload
    });
    return `id: ${ev.eventId}\nevent: ${ev.type}\ndata: ${data}\n\n`;
  }
}

module.exports = { EventStream };

