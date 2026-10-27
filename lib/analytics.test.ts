import { describe, it, expect } from 'vitest';
import { gaPath } from './analytics';

describe('what Google Analytics is told about a page', () => {
  it('hides a flat join code; other paths go as they are', () => {
    expect(gaPath('/en/j/JYVBKW')).toBe('/en/j/code');
    expect(gaPath('/bn/j/abc123/')).toBe('/bn/j/code/');
    expect(gaPath('/en/money')).toBe('/en/money');
    expect(gaPath('/en')).toBe('/en');
  });
});
