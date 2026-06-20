import { describe, it, expect } from 'vitest';
import { computePositions } from './anchor-layout';

describe('computePositions', () => {
  it('returns anchorY unchanged when no collision', () => {
    const notes = [
      { id: 'a', anchorY: 0,   height: 60 },
      { id: 'b', anchorY: 200, height: 60 },
    ];
    const result = computePositions(notes, 8);
    expect(result.find(r => r.id === 'a')!.top).toBe(0);
    expect(result.find(r => r.id === 'b')!.top).toBe(200);
  });

  it('pushes second card down on collision', () => {
    const notes = [
      { id: 'a', anchorY: 100, height: 80 },
      { id: 'b', anchorY: 140, height: 80 },
    ];
    const result = computePositions(notes, 8);
    expect(result.find(r => r.id === 'a')!.top).toBe(100);
    expect(result.find(r => r.id === 'b')!.top).toBe(188);
  });

  it('chains: three cards cascade', () => {
    const notes = [
      { id: 'a', anchorY: 0,  height: 60 },
      { id: 'b', anchorY: 10, height: 60 },
      { id: 'c', anchorY: 20, height: 60 },
    ];
    const result = computePositions(notes, 8);
    expect(result.find(r => r.id === 'a')!.top).toBe(0);
    expect(result.find(r => r.id === 'b')!.top).toBe(68);
    expect(result.find(r => r.id === 'c')!.top).toBe(136);
  });

  it('returns empty array for empty input', () => {
    expect(computePositions([], 8)).toEqual([]);
  });
});
