import { describe, expect, it } from 'vitest';
import { names } from './format';

describe('names', () => {
  it('joins with no comma before and', () => {
    expect(names([], 'and')).toBe('');
    expect(names(['Tahsin'], 'and')).toBe('Tahsin');
    expect(names(['Tahsin', 'Zarif'], 'and')).toBe('Tahsin and Zarif');
    expect(names(['Nafis', 'Tahsin', 'Zarif'], 'আর')).toBe('Nafis, Tahsin আর Zarif');
  });
});
