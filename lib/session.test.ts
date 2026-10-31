import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));
vi.mock('./db', () => ({ db: {} }));

const { requireMember } = await import('./session');

describe('requireMember signed out', () => {
  it('a page open goes to the landing page', async () => {
    await expect(requireMember('en')).rejects.toThrow(/^redirect \/en$/);
  });

  it('a save goes to sign-in with the not-saved note', async () => {
    await expect(requireMember('bn', true)).rejects.toThrow(/^redirect \/bn\/join\?why=out$/);
  });
});
