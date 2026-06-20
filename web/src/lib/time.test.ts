import { describe, it, expect } from 'vitest';
import { formatDuration, formatRelativeTime } from './time';

describe('formatDuration', () => {
  it('formats short durations as M:SS', () => {
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(932)).toBe('15:32');
  });
  it('formats long durations as H:MM:SS', () => {
    expect(formatDuration(3742)).toBe('1:02:22');
    expect(formatDuration(6501)).toBe('1:48:21');
  });
});

describe('formatRelativeTime', () => {
  it('returns "刚刚" for <60s', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
  });
  it('returns "N 分钟前" for minutes', () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
  });
});
