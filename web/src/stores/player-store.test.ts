import { describe, it, expect, beforeEach } from 'vitest';
import { usePlayerStore } from './player-store';

beforeEach(() => {
  usePlayerStore.getState().reset();
});

describe('player-store', () => {
  it('updates currentTime', () => {
    usePlayerStore.getState().setCurrentTime(42);
    expect(usePlayerStore.getState().currentTime).toBe(42);
  });

  it('derives active subtitle index from timestamps', () => {
    const segs = [{ start: 0 }, { start: 30 }, { start: 60 }, { start: 90 }];
    usePlayerStore.getState().setSubtitles(segs);
    usePlayerStore.getState().setCurrentTime(45);
    expect(usePlayerStore.getState().activeIndex).toBe(1);
    usePlayerStore.getState().setCurrentTime(120);
    expect(usePlayerStore.getState().activeIndex).toBe(3);
    usePlayerStore.getState().setCurrentTime(0);
    expect(usePlayerStore.getState().activeIndex).toBe(0);
  });

  it('reset clears state', () => {
    usePlayerStore.getState().setCurrentTime(99);
    usePlayerStore.getState().reset();
    expect(usePlayerStore.getState().currentTime).toBe(0);
    expect(usePlayerStore.getState().subtitles).toEqual([]);
  });
});
