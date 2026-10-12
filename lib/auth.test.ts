import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { openMonth } from './money-db';
import { changePin, createFlat, createSession, flatByCode, listMembers, login, memberBySession, newFlatCode, normalizePhone, renameMember, resetPin, setLeaving, setPhone, bringBack, listGone, addMember } from './auth';

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
    await db(`update members set failed_pin_count = 19 where id = $1`, [memberId]);
    await login(db, code, memberId, '0000', null);
    expect(await wait()).toBe(120);   // the 20th: the last timed lock; the 25th locks for good (pin-lock.test.ts)
  });

  it('reset sets a one-time PIN, ends sessions and forces a new PIN', async () => {
    const { flatId, code, id } = await flat();
    const tahsin = id('Tahsin');
    await login(db, code, tahsin, '5555', null);
    const token = await createSession(db, tahsin);
    expect((await memberBySession(db, token))?.memberId).toBe(tahsin);
    expect(await resetPin(db, flatId, tahsin, '9999', { memberId: id('Nafis') })).toBe(true);
    expect(await memberBySession(db, token)).toBeNull();
    expect(await login(db, code, tahsin, '5555', null)).toEqual({ error: 'wrongPin' });
    expect(await login(db, code, tahsin, '9999', null)).toEqual({ error: 'newPinNeeded' });
    expect(await login(db, code, tahsin, '9999', '4321')).toEqual({ memberId: tahsin });
    expect(await login(db, code, tahsin, '4321', null)).toEqual({ memberId: tahsin });
  });

  it('the collector reset is in the flat history, by whom', async () => {
    const { flatId, code, id } = await flat();
    await login(db, code, id('Tahsin'), '5555', null);
    expect(await resetPin(db, flatId, id('Tahsin'), '9999', { memberId: id('Nafis') })).toBe(true);
    const rows = await db<{ after: unknown; by: string | null }>(`select after, by_member as by from audit_log where flat_id = $1 and entity_id = $2`, [flatId, id('Tahsin')]);
    expect(rows).toEqual([{ after: { pinReset: true }, by: id('Nafis') }]);
    expect(await resetPin(db, flatId, id('Nafis'), '9999', { memberId: id('Nafis') })).toBe(false);   // not my own
    expect(await resetPin(db, flatId, id('Zarif'), '9999', { memberId: id('Tahsin') })).toBe(false);  // only the collector
    await db(`update members set left_on = '2026-10-10' where id = $1`, [id('Zarif')]);
    expect(await resetPin(db, flatId, id('Zarif'), '9999', { memberId: id('Nafis') })).toBe(false);   // moved out
  });

  it('the app team resets only the collector living here, with a reason; nothing but the PIN changes', async () => {
    const { flatId, code, id, memberId: nafis } = await flat();
    await login(db, code, id('Tahsin'), '5555', null);
    const token = await createSession(db, nafis);
    const state = async () => db(`select role, name, joined_on::text, left_on::text, room_id, phone from members where flat_id = $1 order by name`, [flatId]);
    const versions = async () => db(`select month, version from months where flat_id = $1 order by month`, [flatId]);
    await openMonth(db, flatId, '2026-10-01');
    const [s0, v0] = [await state(), await versions()];
    expect(v0).toHaveLength(1);
    const team = { admin: 'Fahim', reason: 'forgot PIN; called him and Tahsin' };
    expect(await resetPin(db, flatId, id('Tahsin'), '7777', team)).toBe(false);                     // not the collector
    expect(await resetPin(db, flatId, nafis, '7777', { admin: 'Fahim', reason: ' ' })).toBe(false);  // no reason
    expect(await resetPin(db, flatId, nafis, '7777', { admin: '', reason: 'x' })).toBe(false);       // no name
    expect(await memberBySession(db, token)).not.toBeNull();
    expect(await resetPin(db, flatId, nafis, '7777', team)).toBe(true);
    expect(await memberBySession(db, token)).toBeNull();                                               // every phone signed out
    expect(await login(db, code, nafis, '1234', null)).toEqual({ error: 'wrongPin' });
    expect(await login(db, code, nafis, '7777', null)).toEqual({ error: 'newPinNeeded' });            // must choose a new one
    expect(await login(db, code, nafis, '7777', '2468')).toEqual({ memberId: nafis });
    expect([await state(), await versions()]).toEqual([s0, v0]);                                       // role, people and months untouched
    const rows = await db<{ entity_id: string; after: unknown; by: string | null }>(`select entity_id, after, by_member as by from audit_log where flat_id = $1 and after ? 'pinReset'`, [flatId]);
    expect(rows).toEqual([{ entity_id: nafis, after: { pinReset: true, ...team }, by: null }]);
  });

  it('a new join code: the old link stops working, everyone stays signed in, only the collector, in the history', async () => {
    const { flatId, code, id, memberId: nafis } = await flat();
    await login(db, code, id('Tahsin'), '5555', null);
    const tahsin = await createSession(db, id('Tahsin'));
    expect(await newFlatCode(db, flatId, { memberId: id('Tahsin'), role: 'member' })).toBeNull();          // not the collector
    expect(await newFlatCode(db, flatId, { memberId: id('Tahsin'), role: 'manager' })).toBeNull();         // a stale role: the database decides
    const fresh = await newFlatCode(db, flatId, { memberId: nafis, role: 'manager' });
    expect(fresh).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(fresh).not.toBe(code);
    expect(await flatByCode(db, code)).toBeNull();                                                         // the old link
    expect((await flatByCode(db, fresh!))?.members.map(m => m.name)).toEqual(['Nafis', 'Tahsin', 'Zarif']);
    expect(await login(db, code, id('Zarif'), '7777', null)).toEqual({ error: 'notFound' });               // can't claim through it
    expect((await memberBySession(db, tahsin))?.joinCode).toBe(fresh);                                     // still signed in
    const rows = await db<{ entity_id: string; after: unknown; by: string }>(`select entity_id, after, by_member as by from audit_log where flat_id = $1 and entity_id = 'flat|code'`, [flatId]);
    expect(rows).toEqual([{ entity_id: 'flat|code', after: { codeChanged: true }, by: nafis }]);
  });

  it('a new code that another flat already has is drawn again', async () => {
    const { flatId, memberId: nafis } = await flat();
    const other = await createFlat(db, { flatName: 'Other', name: 'Rafi', pin: '1234', others: [], today, lang: 'bn' });
    const [{ join_code: taken }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [other.flatId]);
    const draws = [taken, 'ZZZZ22'];
    expect(await newFlatCode(db, flatId, { memberId: nafis, role: 'manager' }, () => draws.shift()!)).toBe('ZZZZ22');
    const [{ join_code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [other.flatId]);
    expect(join_code).toBe(taken);                                                                        // the other flat keeps its code
  });

  it('changes my own PIN with the current one, and signs out my other phones', async () => {
    const { code, memberId } = await flat();
    const here = await createSession(db, memberId), other = await createSession(db, memberId);
    expect(await changePin(db, memberId, '0000', '4321', here)).toEqual({ error: 'wrongPin' });
    expect(await changePin(db, memberId, '1234', '4321', here)).toBe('ok');
    expect(await memberBySession(db, here)).not.toBeNull();     // this phone stays signed in
    expect(await memberBySession(db, other)).toBeNull();        // the others are signed out
    expect(await login(db, code, memberId, '1234', null)).toEqual({ error: 'wrongPin' });
    expect(await login(db, code, memberId, '4321', null)).toEqual({ memberId });
  });

  it('wrong current PINs count toward the same lockout as logging in', async () => {
    const { memberId } = await flat();
    const here = await createSession(db, memberId);
    for (let i = 0; i < 5; i++) expect(await changePin(db, memberId, '0000', '4321', here)).toEqual({ error: 'wrongPin' });
    expect(await changePin(db, memberId, '1234', '4321', here)).toEqual({ error: 'locked' });   // even the right PIN waits now
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
    const leftOn = async (m: string) => (await db<{ l: string | null }>(`select left_on::text as l from members where id = $1`, [m]))[0].l;
    const history = async (m: string) => (await db<{ after: { left: string | null } }>(`select after from audit_log where entity = 'members' and entity_id = $1 order by id`, [m])).map(r => r.after.left);
    expect(await setLeaving(db, flatId, memberId, id('Zarif'), '2099-01-20', today)).toBe('ok');
    expect(await leftOn(id('Zarif'))).toBe('2099-01-20');
    expect(await setLeaving(db, flatId, memberId, id('Zarif'), '2099-01-20', today)).toBe('ok');   // the same day again: no second history line
    expect(await setLeaving(db, flatId, memberId, memberId, '2099-01-20', today)).toBe('no');       // hands the flat over first
    await db(`update members set joined_on = '2026-10-01' where id = $1`, [id('Tahsin')]);
    expect(await setLeaving(db, flatId, memberId, id('Tahsin'), '2026-10-08', today)).toBe('no');   // yesterday was already cooked
    await db(`update members set joined_on = '2026-10-15' where id = $1`, [id('Tahsin')]);
    expect(await setLeaving(db, flatId, memberId, id('Tahsin'), '2026-10-12', today)).toBe('no');   // before moving in
    expect(await setLeaving(db, flatId, memberId, id('Zarif'), null, today)).toBe('ok');             // staying after all
    expect(await setLeaving(db, flatId, memberId, id('Zarif'), null, today)).toBe('ok');             // a stale page: nothing more
    expect(await leftOn(id('Zarif'))).toBeNull();
    expect(await history(id('Zarif'))).toEqual(['2099-01-20', null]);
  });

  it('on the last day they can still sign in and are listed; after it they can’t, and stay gone', async () => {
    const { flatId, memberId, code, id } = await flat();
    const zarif = id('Zarif');
    await login(db, code, zarif, '4321', null);
    const token = await createSession(db, zarif);
    // the real Dhaka today, whatever day the tests run
    await db(`update members set joined_on = '2020-01-01', left_on = (now() at time zone 'Asia/Dhaka')::date where id = $1`, [zarif]);
    expect(await memberBySession(db, token)).not.toBeNull();
    expect((await listMembers(db, flatId)).map(m => m.name)).toContain('Zarif');
    await db(`update members set left_on = '2020-01-31' where id = $1`, [zarif]);   // long gone
    expect(await memberBySession(db, token)).toBeNull();
    expect('error' in (await login(db, code, zarif, '4321', null))).toBe(true);
    expect((await flatByCode(db, code))!.members.map(m => m.name)).not.toContain('Zarif');
    expect((await listMembers(db, flatId)).map(m => m.name)).not.toContain('Zarif');
    expect((await listGone(db, flatId, '2020-01-01')).map(m => m.name)).toEqual(['Zarif']);
    expect(await setLeaving(db, flatId, memberId, zarif, null, today)).toBe('no');
  });

  it('a name comes back once its person has gone, but two people living here at once need different names', async () => {
    const { flatId, memberId, id } = await flat();
    const zarif = id('Zarif');
    expect(await addMember(db, flatId, 'Zarif', '2026-10-21', memberId)).toBe(false);                          // the old Zarif still lives here
    expect(await setLeaving(db, flatId, memberId, zarif, '2026-10-20', today)).toBe('ok');
    expect(await addMember(db, flatId, 'Zarif', '2026-10-20', memberId)).toBe(false);                          // both here on the 20th
    expect(await addMember(db, flatId, 'Zarif', '2026-10-21', memberId)).toBe(true);                           // the new Zarif moves in after
    // the history says who added the name and from when; the two refused tries wrote nothing
    expect(await db(`select 1 from audit_log where flat_id = $1 and entity = 'members' and after->>'added' = '2026-10-21' and by_member = $2`, [flatId, memberId])).toHaveLength(1);
    expect(await db(`select 1 from audit_log where flat_id = $1 and after ? 'added'`, [flatId])).toHaveLength(1);
    expect(await setLeaving(db, flatId, memberId, zarif, null, today)).toBe('taken');                // old Zarif can't stay on now
    expect(await renameMember(db, flatId, memberId, id('Tahsin'), 'Zarif')).toBe('taken');
  });

  it('bringing back someone marked gone by mistake keeps every past day as it was and counts them from tomorrow', async () => {
    const { flatId, memberId, id } = await flat();
    const zarif = id('Zarif'), t = '2026-10-09';
    await db(`update members set joined_on = '2026-10-01', left_on = '2026-10-06' where id = $1`, [zarif]);
    await db(`insert into meal_changes (flat_id, member_id, date, meal, count, guests) values ($1, $2, '2026-10-08', 'd', 2, 1)`, [flatId, zarif]);
    const from = '2026-09-01';   // the first day meals can still be fixed
    expect(await bringBack(db, flatId, memberId, memberId, t, from)).toBe('no');                   // only someone who has gone
    expect(await bringBack(db, flatId, memberId, zarif, t, from)).toBe('ok');
    const rows = await db<{ date: string; count: number }>(`select date::text as date, sum(count)::int as count from meal_changes where member_id = $1 group by date order by date`, [zarif]);
    expect(rows).toEqual(['2026-10-07', '2026-10-08', '2026-10-09'].map(date => ({ date, count: 0 })));   // 7th to today: no meals, the old guest row too
    expect((await db<{ l: string | null }>(`select left_on::text as l from members where id = $1`, [zarif]))[0].l).toBeNull();
    const [log] = await db<{ after: { back: string[] } }>(`select after from audit_log where entity_id = $1 order by id desc limit 1`, [zarif]);
    expect(log.after.back).toEqual(['2026-10-07', t]);
    expect(await bringBack(db, flatId, memberId, zarif, t, from)).toBe('no');                      // already back
    const history = await db(`select 1 from audit_log where entity_id = $1 and after ? 'back'`, [zarif]);
    expect(history.length).toBe(1);
  });

  it('only someone who left recently can be brought back; who left long ago is added as new', async () => {
    const { flatId, memberId, id } = await flat();
    const zarif = id('Zarif');
    await db(`update members set joined_on = '2026-01-01', left_on = '2026-03-31' where id = $1`, [zarif]);
    expect((await listGone(db, flatId, '2026-09-01')).map(m => m.name)).toEqual([]);
    expect(await bringBack(db, flatId, memberId, zarif, '2026-10-09', '2026-09-01')).toBe('no');
    expect((await db(`select 1 from meal_changes where member_id = $1`, [zarif])).length).toBe(0);
    expect(await addMember(db, flatId, 'Zarif', '2026-10-09', memberId)).toBe(true);
  });
});
