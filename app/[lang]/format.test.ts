import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDay, names } from './format';

describe('names', () => {
  it('joins with no comma before and', () => {
    expect(names([], 'and')).toBe('');
    expect(names(['Tahsin'], 'and')).toBe('Tahsin');
    expect(names(['Tahsin', 'Zarif'], 'and')).toBe('Tahsin and Zarif');
    expect(names(['Nafis', 'Tahsin', 'Zarif'], 'আর')).toBe('Nafis, Tahsin আর Zarif');
  });
});

describe('fmtDate', () => {
  it('is fmtDay without the weekday', () => {
    expect(fmtDate('2026-11-04')).toBe('4 November');
    expect(fmtDay('2026-11-04', 'en')).toBe('Wed, 4 November');
  });
});
