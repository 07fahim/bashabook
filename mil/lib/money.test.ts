import { describe, it, expect } from 'vitest';
import { allocate } from './money';

describe('allocate', () => {
  it('splits exactly with largest remainder, ties to lowest index', () => {
    expect(allocate(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });
  it('prorates by days: 31 vs 21 days of 310 taka', () => {
    expect(allocate(31000, [31, 21])).toEqual([18481, 12519]);
  });
  it('returns null when every weight is 0', () => {
    expect(allocate(500, [0, 0])).toBeNull();
  });
  it('refuses non-integers (e.g. amounts that arrived as strings or decimals)', () => {
    expect(() => allocate(10.5, [1, 1])).toThrow(TypeError);
    expect(() => allocate('100' as unknown as number, [1])).toThrow(TypeError);
  });
});
