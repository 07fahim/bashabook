import { describe, expect, it } from 'vitest';
process.env.DATABASE_URL ??= 'postgres://u:p@localhost:1/x';   // postgres.js connects only on the first query
const { withRetry } = await import('./db');

const fails = (...errs: object[]) => {
  let n = 0;
  const run = async () => { n++; const e = errs.shift(); if (e) throw e; return ['ok'] as never; };
  return { run, tries: () => n };
};

describe('db retries', () => {
  it('runs again when a dead pooled connection resets on begin, up to 10 times', async () => {
    const reset = () => ({ code: 'ECONNRESET', query: 'begin ' });
    const f = fails(reset(), reset(), reset());
    expect(await withRetry(f.run)('select 1')).toEqual(['ok']);
    expect(f.tries()).toBe(4);
    const g = fails(...Array.from({ length: 11 }, reset));
    await expect(withRetry(g.run)('select 1')).rejects.toMatchObject({ code: 'ECONNRESET' });
    expect(g.tries()).toBe(11);
  });

  it('never runs again when the outcome is unknown: a reset on commit, a connection closed mid-transaction', async () => {
    for (const e of [{ code: 'ECONNRESET', query: 'commit' }, { code: 'CONNECTION_CLOSED' }, { code: '23505' }]) {
      const f = fails(e);
      await expect(withRetry(f.run)('insert')).rejects.toMatchObject(e);
      expect(f.tries()).toBe(1);
    }
  });

  it('runs a deadlocked statement once more, not twice', async () => {
    const dead = () => ({ code: '40P01' });
    const f = fails(dead());
    expect(await withRetry(f.run)('update')).toEqual(['ok']);
    const g = fails(dead(), dead());
    await expect(withRetry(g.run)('update')).rejects.toMatchObject({ code: '40P01' });
    expect(g.tries()).toBe(2);
  });
});
