import { describe, it, expect } from 'vitest';
import { gaPath, gaRef } from './analytics';

describe('what Google Analytics is told about a page', () => {
  it('hides a flat join code; other paths go as they are', () => {
    expect(gaPath('/en/j/JYVBKW')).toBe('/en/j/code');
    expect(gaPath('/bn/j/abc123/')).toBe('/bn/j/code/');
    expect(gaPath('/en/money')).toBe('/en/money');
    expect(gaPath('/en')).toBe('/en');
  });
  it('cleans a referrer: code hidden, query and fragment dropped, empty stays empty', () => {
    expect(gaRef('https://x.dev/en/j/AB12C3/?m=0f8b')).toBe('https://x.dev/en/j/code/');
    expect(gaRef('https://x.dev/en/money?m=2026-09#entries')).toBe('https://x.dev/en/money');
    expect(gaRef('')).toBe('');
  });
});
