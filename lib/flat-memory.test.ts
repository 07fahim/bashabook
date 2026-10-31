import { describe, expect, it } from 'vitest';
import { readFlat } from './flat-memory';

describe('readFlat', () => {
  it('reads a kept flat', () => expect(readFlat('{"code":"4FTSRA","name":"Flat 4B"}')).toEqual({ code: '4FTSRA', name: 'Flat 4B' }));
  it('drops anything else kept with it', () => expect(readFlat('{"code":"4FTSRA","name":"Flat 4B","x":1}')).toEqual({ code: '4FTSRA', name: 'Flat 4B' }));
  it('nothing kept or not JSON', () => { expect(readFlat(null)).toBeNull(); expect(readFlat('')).toBeNull(); expect(readFlat('{')).toBeNull(); expect(readFlat('null')).toBeNull(); });
  it('a code that is not a join code', () => {
    for (const code of ['4ftsra', '4FTSR', '4FTSRA7', '../x', 'AB CD1', 42]) expect(readFlat(JSON.stringify({ code, name: 'Flat 4B' }))).toBeNull();
  });
  it('a name that is empty, blank, too long or not text', () => {
    for (const name of ['', '   ', 'x'.repeat(100), 7, null]) expect(readFlat(JSON.stringify({ code: '4FTSRA', name }))).toBeNull();
  });
});
