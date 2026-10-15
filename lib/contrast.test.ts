import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
const vars = (body = '') => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
const light = vars(css.match(/:root\s*{([^}]*)}/)?.[1]);
const dark = { ...light, ...vars(css.match(/:root\[data-theme="dark"\]\s*{([^}]*)}/)?.[1]) };

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const pairs = [
  ['ink', 'paper'], ['ink', 'surface'], ['muted', 'paper'], ['muted', 'surface'],
  ['turmeric-ink', 'paper'], ['turmeric-ink', 'surface'], ['leaf', 'paper'], ['leaf', 'surface'],
  ['chili', 'paper'], ['chili', 'surface'], ['on-turmeric', 'turmeric'], ['paper', 'chili'],
];

describe.each([['light', light], ['dark', dark]] as const)('%s theme', (_, theme) => {
  it.each(pairs)('%s on %s meets WCAG AA', (fg, bg) => {
    expect(theme[fg], `missing --${fg}`).toBeDefined();
    expect(ratio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
