import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { changePin, createFlat, createSession, flatByCode, listMembers, login, memberBySession, normalizePhone, renameMember, resetPin, setLeaving, setPhone } from './auth';

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

  it('changes my own PIN with the current one, and signs out my other phones', async () => {
    const { code, memberId } = await flat();
    const here = await createSession(db, memberId), other = await createSession(db, memberId);
    expect(await changePin(db, memberId, '0000', '4321', here)).toBe('wrongPin');
    expect(await changePin(db, memberId, '1234', '4321', here)).toBe('ok');
    expect(await memberBySession(db, here)).not.toBeNull();     // this phone stays signed in
    expect(await memberBySession(db, other)).toBeNull();        // the others are signed out
    expect(await login(db, code, memberId, '1234', null)).toEqual({ error: 'wrongPin' });
    expect(await login(db, code, memberId, '4321', null)).toEqual({ memberId });
  });

  it('wrong current PINs count toward the same lockout as logging in', async () => {
    const { memberId } = await flat();
    const here = await createSession(db, memberId);
    for (let i = 0; i < 5; i++) expect(await changePin(db, memberId, '0000', '4321', here)).toBe('wrongPin');
    expect(await changePin(db, memberId, '1234', '4321', here)).toBe('locked');   // even the right PIN waits now
  });

  it('the person who runs the flat fixes a name; a name already in the flat is refused', async () => {
    const { flatId, memberId, id } = await flat();
    expect(await renameMember(db, flatId, memberId, id('Tahsin'), 'Tahsin Ahmed')).toBe('ok');
    expect(await renameMember(db, flatId, memberId, id('Zarif'), 'Tahsin Ahmed')).toBe('taken');
    expect(await renameMember(db, flatId, memberId, 'not-a-uuid', 'X')).toBe('notFound');
    const [log] = await db<{ after: { rename: [string, string] } }>(`select after from audit_log where flat_id = $1 and entity = 'members'`, [flatId]);
    expect(log.after.rename).toEqual(['Tahsin', 'Tahsin Ahmed']);
  });

  it('renaming someone to the name they already have changes nothing and writes no history', async () => {
    const { flatId, memberId, id } = await flat();
    expect(await renameMember(db, flatId, memberId, id('Zarif'), 'Zarif')).toBe('ok');
    expect(await db(`select 1 from audit_log where flat_id = $1 and entity = 'members'`, [flatId])).toEqual([]);
  });

  it('reads a Bangladeshi mobile number however it is typed', () => {
    expect(normalizePhone('01712345678')).toBe('01712345678');
    expect(normalizePhone('+880 1712-345678')).toBe('01712345678');
    expect(normalizePhone('৮৮০১৭১২৩৪৫৬৭৮')).toBe('01712345678');   // Bangla keyboard digits
    expect(normalizePhone('0171234567')).toBeNull();                 // one digit short
    expect(normalizePhone('01212345678')).toBeNull();                // no operator starts 012
  });

  it('saves my phone number for the flat to see; the database refuses a bad one', async () => {
    const { flatId, memberId } = await flat();
    await setPhone(db, memberId, '01712345678');
    expect((await listMembers(db, flatId)).find(m => m.id === memberId)!.phone).toBe('01712345678');
    await setPhone(db, memberId, null);
    expect((await listMembers(db, flatId)).find(m => m.id === memberId)!.phone).toBeNull();
    await expect(setPhone(db, memberId, '123')).rejects.toThrow();
  });

  it('the person who runs the flat sets someone’s last day, never their own, never a day already gone; it can be taken back', async () => {
    const { flatId, memberId, id } = await flat();
    expect(await setLeaving(db, flatId, memberId, id('Zarif'), '2026-10-20', today)).toBe(true);
    expect((await listMembers(db, flatId)).find(m => m.id === id('Zarif'))!.leftOn).toBe('2026-10-20');
    expect(await setLeaving(db, flatId, memberId, memberId, '2026-10-20', today)).toBe(false);       // hands the flat over first
    await db(`update members set joined_on = '2026-10-01' where id = $1`, [id('Tahsin')]);
    expect(await setLeaving(db, flatId, memberId, id('Tahsin'), '2026-10-08', today)).toBe(false);   // yesterday was already cooked
    await db(`update members set joined_on = '2026-10-15' where id = $1`, [id('Tahsin')]);
    expect(await setLeaving(db, flatId, memberId, id('Tahsin'), '2026-10-12', today)).toBe(false);   // before moving in
    expect(await setLeaving(db, flatId, memberId, id('Zarif'), null, today)).toBe(true);             // staying after all
    expect((await listMembers(db, flatId)).find(m => m.id === id('Zarif'))!.leftOn).toBeNull();
    const log = await db<{ after: { left: string | null } }>(`select after from audit_log where entity = 'members' and entity_id = $1 order by id`, [id('Zarif')]);
    expect(log.map(r => r.after.left)).toEqual(['2026-10-20', null]);
  });

  it('someone whose last day has passed can’t sign in, be picked or be listed, and stays gone', async () => {
    const { flatId, memberId, code, id } = await flat();
    const zarif = id('Zarif');
    await login(db, code, zarif, '4321', null);
    const token = await createSession(db, zarif);
    await db(`update members set joined_on = '2020-01-01', left_on = '2020-01-31' where id = $1`, [zarif]);   // long gone, whatever today is
    expect(await memberBySession(db, token)).toBeNull();
    expect('error' in (await login(db, code, zarif, '4321', null))).toBe(true);
    expect((await flatByCode(db, code))!.members.map(m => m.name)).not.toContain('Zarif');
    expect((await listMembers(db, flatId)).map(m => m.name)).not.toContain('Zarif');
    expect(await setLeaving(db, flatId, memberId, zarif, null, today)).toBe(false);
  });
});
