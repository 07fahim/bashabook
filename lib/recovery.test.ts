import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat, createSession, emailOf, login, memberBySession } from './auth';
import { checkCode, endRecovery, flatsFor, PER_DAY, provenEmail, recoverPin, recoveryOf, startRecovery } from './recovery';

const today = '2026-10-09';
let n = 0;
/** A flat whose starter Nafis (PIN 4827) has a fresh email, and an unclaimed Tahsin. */
async function flat() {
  await migrate();
  const email = `nafis${++n}@gmail.com`;
  const { flatId, memberId } = await createFlat(db, { flatName: `Flat ${n}`, name: 'Nafis', pin: '4827', others: ['Tahsin'], today, lang: 'en', email });
  const [{ join_code: code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
  const [{ id: tahsin }] = await db<{ id: string }>(`select id from members where flat_id = $1 and name = 'Tahsin'`, [flatId]);
  return { flatId, memberId, code, email, tahsin, flatName: `Flat ${n}` };
}
/** Someone who lived here earlier this year and has moved out. */
const moveOut = (memberId: string) => db(`update members set joined_on = '2026-01-01', left_on = '2026-02-01' where id = $1`, [memberId]);
const other = (code: string) => (code === '000000' ? '000001' : '000000');

describe('recovery by email code', { timeout: 30000 }, () => {
  it('sends only to an email someone living in a flat has, but makes the same row for any email', async () => {
    const { email } = await flat();
    const known = (await startRecovery(db, email))!;
    expect(known.send).toBe(true);
    expect(known.code).toMatch(/^\d{6}$/);
    const unknown = (await startRecovery(db, 'nobody@gmail.com'))!;
    expect(unknown.send).toBe(false);
    expect(await recoveryOf(db, unknown.token)).toEqual({ email: 'nobody@gmail.com', proven: false });
    expect(await recoveryOf(db, 'not-a-token')).toBeNull();
  });

  it('a moved-out person gets no code and no flat', async () => {
    const { code, tahsin } = await flat();
    await login(db, code, tahsin, '5827', null, 'tahsin.gone@gmail.com');
    await moveOut(tahsin);
    expect((await startRecovery(db, 'tahsin.gone@gmail.com'))!.send).toBe(false);
    expect(await flatsFor(db, 'tahsin.gone@gmail.com')).toEqual([]);
  });

  it('five tries at a code, then even the right one is refused', async () => {
    const { email } = await flat();
    const r = (await startRecovery(db, email))!;
    for (let left = 4; left >= 0; left--) expect(await checkCode(db, r.token, other(r.code))).toEqual({ wrong: left });
    expect(await checkCode(db, r.token, r.code)).toBe('expired');
    expect(await recoveryOf(db, r.token)).toBeNull();
  });

  it('an expired code is refused', async () => {
    const { email } = await flat();
    const r = (await startRecovery(db, email))!;
    await db(`update recoveries set expires_at = now() - interval '1 second' where email = $1`, [email]);
    expect(await checkCode(db, r.token, r.code)).toBe('expired');
    expect(await recoveryOf(db, r.token)).toBeNull();
  });

  it('the right code proves the email, confirms it and lists the flats with their codes', async () => {
    const { email, memberId, code, flatName } = await flat();
    const r = (await startRecovery(db, email))!;
    expect(await provenEmail(db, r.token)).toBeNull();
    expect(await checkCode(db, r.token, r.code)).toBe('ok');
    expect(await recoveryOf(db, r.token)).toEqual({ email, proven: true });
    expect(await provenEmail(db, r.token)).toBe(email);
    expect((await emailOf(db, memberId)).ok).toBe(true);
    expect(await flatsFor(db, email)).toEqual([{ memberId, name: 'Nafis', flatName, code }]);
    expect(await checkCode(db, r.token, r.code)).toBe('expired');   // a proven step takes no more tries
  });

  it('a new PIN only for the proven email’s own person: clears a permanent lock, signs every phone out, says so in the history, works once', async () => {
    const a = await flat(), b = await flat();
    const r = (await startRecovery(db, a.email))!;
    expect(await recoverPin(db, r.token, a.memberId, '5927')).toBe(false);   // not proven yet
    expect(await checkCode(db, r.token, r.code)).toBe('ok');
    expect(await recoverPin(db, r.token, b.memberId, '5927')).toBe(false);   // someone else's account
    expect(await recoverPin(db, r.token, 'not-a-uuid', '5927')).toBe(false);
    await db(`update members set failed_pin_count = 25, locked_until = 'infinity', must_change_pin = true where id = $1`, [a.memberId]);
    const session = await createSession(db, a.memberId);
    expect(await recoverPin(db, r.token, a.memberId, '5927')).toBe(true);
    expect(await memberBySession(db, session)).toBeNull();
    expect(await login(db, a.code, a.memberId, '5927', null, null)).toEqual({ memberId: a.memberId });
    const rows = await db<{ after: unknown; by: string }>(`select after, by_member as by from audit_log where entity_id = $1 and after ? 'pinReset'`, [a.memberId]);
    expect(rows).toEqual([{ after: { pinReset: true, email: true }, by: a.memberId }]);
    expect(await recoverPin(db, r.token, a.memberId, '6038')).toBe(false);   // the step is used up
    expect(await recoveryOf(db, r.token)).toBeNull();
  });

  it('moving out between the code and the new PIN stops the new PIN', async () => {
    const { code, tahsin } = await flat();
    await login(db, code, tahsin, '5827', null, 'tahsin.leaving@gmail.com');
    const r = (await startRecovery(db, 'tahsin.leaving@gmail.com'))!;
    expect(await checkCode(db, r.token, r.code)).toBe('ok');
    await moveOut(tahsin);
    expect(await recoverPin(db, r.token, tahsin, '5927')).toBe(false);
  });

  it(`at most ${PER_DAY} codes per email in 24 hours; another email is separate`, async () => {
    const { email } = await flat();
    for (let i = 0; i < PER_DAY; i++) expect(await startRecovery(db, email)).not.toBeNull();
    expect(await startRecovery(db, email)).toBeNull();
    expect(await startRecovery(db, 'someone.else@gmail.com')).not.toBeNull();
  });

  it('ending a step removes it', async () => {
    const r = (await startRecovery(db, 'end.me@gmail.com'))!;
    await endRecovery(db, r.token);
    expect(await recoveryOf(db, r.token)).toBeNull();
  });
});
