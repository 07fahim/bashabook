import { describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => jar.has(k) ? { value: jar.get(k) } : undefined, delete: (k: string) => jar.delete(k) }) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));
const calls: unknown[][] = [];
vi.mock('./db', () => ({ db: async (...a: unknown[]) => { calls.push(a); return []; } }));

const { requireMember, endSession } = await import('./session');
const { hashToken } = await import('./auth');

describe('requireMember signed out', () => {
  it('a page open goes to the landing page', async () => {
    await expect(requireMember('en')).rejects.toThrow(/^redirect \/en$/);
  });

  it('a save goes to sign-in with the not-saved note', async () => {
    await expect(requireMember('bn', true)).rejects.toThrow(/^redirect \/bn\/join\?why=out$/);
  });
});

describe('endSession', () => {
  it('also retires and drops any email check or recovery step on this browser', async () => {
    jar.set('session', 's1'); jar.set('check', 'c1'); jar.set('recover', 'r1');
    await endSession();
    expect([...jar.keys()]).toEqual([]);
    const retired = calls.filter(([sql]) => String(sql).includes('recoveries')).map(([, p]) => (p as string[])[0]);
    expect(retired.sort()).toEqual([hashToken('c1'), hashToken('r1')].sort());
  });
});
