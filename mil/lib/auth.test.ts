import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat, createSession, flatByCode, login, memberBySession, resetPin } from './auth';

const today = '2026-10-09';

async function flat(others = ['Tahsin', 'Zarif']) {
  await migrate();
  const { flatId, memberId } = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others, today, lang: 'bn' });
  const [{ join_code: code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
  const f = (await flatByCode(db, code))!;
  const id = (name: string) => f.members.find(m => m.name === name)!.id;
  return { flatId, memberId, code, f, id };
}

describe('auth', { timeout: 30000 }, () => {
  it('creates a flat with its starter and unclaimed names', async () => {
    const { f, code } = await flat(['Tahsin', 'Zarif', 'Tahsin', 'Nafis']);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect((await flatByCode(db, code.toLowerCase()))?.name).toBe('Flat 4B');
    expect(f.members.map(m => [m.name, m.claimed])).toEqual([['Nafis', true], ['Tahsin', false], ['Zarif', false]]);
  });

  it('lets a name be claimed once, then asks for its PIN', async () => {
    const { code, id } = await flat();
    expect(await login(db, code, id('Tahsin'), '5555', null)).toEqual({ memberId: id('Tahsin') });
    expect(await login(db, code, id('Tahsin'), '6666', null)).toEqual({ error: 'wrongPin' });
    expect(await login(db, code, id('Tahsin'), '5555', null)).toEqual({ memberId: id('Tahsin') });
    expect(await login(db, code, 'not-a-uuid', '5555', null)).toEqual({ error: 'notFound' });
  });

  it('locks after 5 wrong PINs and doubles the wait each time', async () => {
    const { code, memberId } = await flat();
    const wait = async () => Number((await db<{ m: string }>(`select round(extract(epoch from locked_until - now()) / 60) as m from members where id = $1`, [memberId]))[0].m);
    for (let i = 0; i < 5; i++) expect(await login(db, code, memberId, '0000', null)).toEqual({ error: 'wrongPin' });
    expect(await login(db, code, memberId, '1234', null)).toEqual({ error: 'locked' });
    expect(await wait()).toBe(15);
    await db(`update members set locked_until = now() - interval '1 second' where id = $1`, [memberId]);
    for (let i = 0; i < 5; i++) await login(db, code, memberId, '0000', null);
    expect(await wait()).toBe(30);
    await db(`update members set locked_until = null where id = $1`, [memberId]);
    expect(await login(db, code, memberId, '1234', null)).toEqual({ memberId });
    const [{ failed_pin_count }] = await db<{ failed_pin_count: number }>(`select failed_pin_count from members where id = $1`, [memberId]);
    expect(failed_pin_count).toBe(0);
    await db(`update members set failed_pin_count = 24 where id = $1`, [memberId]);
    await login(db, code, memberId, '0000', null);
    expect(await wait()).toBe(240);   // capped at 4 hours
  });

  it('reset sets a one-time PIN, ends sessions and forces a new PIN', async () => {
    const { flatId, code, id } = await flat();
    const tahsin = id('Tahsin');
    await login(db, code, tahsin, '5555', null);
    const token = await createSession(db, tahsin);
    expect((await memberBySession(db, token))?.memberId).toBe(tahsin);
    expect(await resetPin(db, flatId, tahsin, '9999')).toBe(true);
    expect(await memberBySession(db, token)).toBeNull();
    expect(await login(db, code, tahsin, '5555', null)).toEqual({ error: 'wrongPin' });
    expect(await login(db, code, tahsin, '9999', null)).toEqual({ error: 'newPinNeeded' });
    expect(await login(db, code, tahsin, '9999', '4321')).toEqual({ memberId: tahsin });
    expect(await login(db, code, tahsin, '4321', null)).toEqual({ memberId: tahsin });
  });
});
