import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, migrate, pg } from '../db/test-db';
import { createFlat } from './auth';
import { checkEntry, entryDetail, fixEntry, itemsFor, itemsOk, monthTotals, otherItems, parseItems, receiptOf, toCheck, type Fix } from './bazar';
import { closeMonth, closeInfo } from './close';
import { acceptHandover, currentOffer, flatMoney, offerHandover } from './handover';
import { addEntry, loadMonth, openMonth, putBack, removeEntry, type Actor, type NewEntry } from './money-db';

const OCT = '2026-10-01', TODAY = '2026-10-09';
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-10-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
const jpeg = (n = 100) => Uint8Array.from({ length: n }, (_, i) => (i < 3 ? [0xff, 0xd8, 0xff][i] : i % 251));
// the backfill block of 020, read from the migration itself
const backfill = () => readFileSync(join(__dirname, '../db/migrations/020_bazar_check.sql'), 'utf8').split('-- backfill start')[1].split('-- backfill end')[0];

/** A flat from `start` (Nafis collects), its months open up to October. `add` saves an entry with a fresh id and returns it. */
async function flat(others = ['Tahsin', 'Zarif'], start = OCT) {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others, today: start, lang: 'bn' });
  const ids: Record<string, string> = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis: Actor = { memberId: ids.Nafis, role: 'manager' };
  const as = (name: string): Actor => ({ memberId: ids[name], role: 'member' });
  await openMonth(db, f.flatId, start);
  if (start < OCT) await openMonth(db, f.flatId, OCT);
  const add = async (by: Actor, p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>) => {
    const id = randomUUID();
    expect(await addEntry(db, f.flatId, by, e({ id, ...p }), TODAY)).toBe('ok');
    return id;
  };
  const may = async (id: string, who: string) =>
    (await db<{ ok: boolean | null }>(`select may_check($1, $2, $3::text::date) as ok`, [id, ids[who], TODAY]))[0].ok;
  return { flatId: f.flatId, ids, nafis, as, add, may };
}

describe('bazar checks: the database', { timeout: 30000 }, () => {
  it('who may check: the collector; never their own spending; then another member living here; the collector if nobody else', async () => {
    const { ids, nafis, as, add, may } = await flat();
    const tahsins = await add(as('Tahsin'), { type: 'bazar', amount: 1000, paidBy: ids.Tahsin });
    expect([await may(tahsins, 'Nafis'), await may(tahsins, 'Tahsin'), await may(tahsins, 'Zarif')]).toEqual([true, false, false]);
    const fund = await add(nafis, { type: 'bazar', amount: 1000 });   // flat money: the collector's own spending
    expect([await may(fund, 'Nafis'), await may(fund, 'Tahsin'), await may(fund, 'Zarif')]).toEqual([false, true, true]);
    const viaFund = await add(as('Tahsin'), { type: 'bazar', amount: 1000 });   // Tahsin added it, flat money paid it
    expect([await may(viaFund, 'Nafis'), await may(viaFund, 'Tahsin'), await may(viaFund, 'Zarif')]).toEqual([false, false, true]);
    await db(`update members set left_on = '2026-10-08' where id = $1`, [ids.Zarif]);   // Zarif moved out before today
    expect(await may(viaFund, 'Zarif')).toBe(false);
    expect(await may(viaFund, 'Nafis')).toBe(true);   // nobody else is left: the collector after all
    expect(await may(randomUUID(), 'Nafis')).toBeNull();
    await db(`update members set left_on = $2::text::date where id = $1`, [ids.Zarif, TODAY]);   // moving out today: still here
    expect(await may(viaFund, 'Zarif')).toBe(true);
    await db(`update members set left_on = null, joined_on = '2026-10-10' where id = $1`, [ids.Zarif]);   // joins tomorrow: not yet
    expect(await may(viaFund, 'Zarif')).toBe(false);
  });

  it('a flat of one: the collector checks their own', async () => {
    const { nafis, add, may } = await flat([]);
    expect(await may(await add(nafis, { type: 'bazar', amount: 1000 }), 'Nafis')).toBe(true);
  });

  it('the backfill marks every bazar and bill from before Verified, nothing else, and is safe to run twice', async () => {
    const { flatId, ids, nafis, add } = await flat();
    const bazar = await add(nafis, { type: 'bazar', amount: 1000 });
    const bill = await add(nafis, { type: 'bill', amount: 2000, note: 'Gas', split: 'equal' });
    await add(nafis, { type: 'deposit', amount: 3000, memberId: ids.Nafis });
    for (let i = 0; i < 2; i++) await pg.exec(backfill());
    const rows = await db<{ id: string; state: string; by: string | null }>(
      `select ledger_id as id, state, by_member as by from entry_checks where flat_id = $1 order by ledger_id`, [flatId]);
    expect(rows).toEqual([bazar, bill].sort().map(id => ({ id, state: 'ok', by: null })));
  });
});

describe('bazar items and receipts', { timeout: 30000 }, () => {
  it('reads item lines: empty lines skipped; a lone amount, a long name or a bad amount refused', () => {
    expect(parseItems(['Rice', '', ' Oil '], ['450', '', ''])).toEqual([{ name: 'Rice', amount: 45000 }, { name: 'Oil', amount: null }]);
    expect(parseItems(['', ''], ['', ''])).toEqual([]);
    expect(parseItems([''], ['120'])).toBeNull();
    expect(parseItems(['x'.repeat(41)], [''])).toBeNull();
    expect(parseItems(['Rice'], ['abc'])).toBeNull();
    expect(parseItems(Array.from({ length: 31 }, (_, i) => `x${i}`), [])).toBeNull();
    expect(otherItems([{ name: 'Rice', amount: 45000 }, { name: 'Oil', amount: null }], 60000)).toBe(15000);
    expect(otherItems([{ name: 'Oil', amount: null }], 60000)).toBe(0);   // no amounts at all: no Other items line
    expect(itemsOk([{ name: 'Rice', amount: 100 }], 100)).toBe(true);
    expect(itemsOk([{ name: 'Rice‮', amount: null }], 100)).toBe(false);   // a bidi or control character: not as cleaned
    expect(itemsOk([{ name: ' Rice', amount: null }], 100)).toBe(false);
  });

  it('totals: paid in counts confirmed deposits; total spent is bazar plus bills whoever paid; corrections stay out', () => {
    const r = (type: string, amount: number, status = 'ok', forMonth: string | null = null) => ({ type, amount, status, forMonth });
    expect(monthTotals([r('deposit', 500), r('deposit', 300, 'pending'), r('bazar', 200), r('bill', 100), r('bazar', 50, 'ok', '2026-09-01'), r('payout', 70)]))
      .toEqual({ bazar: 200, bills: 100, spent: 300, paidIn: 500 });
  });

  it('a bazar counts at once, before any check, and keeps its item lines and receipt', async () => {
    const { flatId, ids, as, add } = await flat();
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 90000, paidBy: ids.Tahsin, items: [{ name: 'Rice', amount: 50000 }, { name: 'Oil', amount: null }], receipt: jpeg() });
    const mo = await loadMonth(db, flatId, OCT, TODAY);
    expect(mo.result.perMember.reduce((a, m) => a + m.foodCost, 0)).toBe(90000);
    const x = mo.entries.find(r => r.id === id)!;
    expect(x.check).toBeNull();
    expect(x.receiptV).toMatch(/^\d+$/);
    expect((await itemsFor(db, flatId, OCT)).get(id)).toEqual([{ name: 'Rice', amount: 50000 }, { name: 'Oil', amount: null }]);
    expect(Array.from((await receiptOf(db, flatId, id))!.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  });

  it('refuses item amounts over the total, a 31st line, items on a bill and a receipt that is not a small JPEG on a bazar or bill', async () => {
    const { flatId, ids, nafis, as } = await flat();
    const t = as('Tahsin'), bz = (p: Partial<NewEntry>) => e({ type: 'bazar', amount: 1000, paidBy: ids.Tahsin, ...p });
    expect(await addEntry(db, flatId, t, bz({ items: [{ name: 'Rice', amount: 1001 }] }), TODAY)).toBe('items');
    expect(await addEntry(db, flatId, t, bz({ items: Array.from({ length: 31 }, (_, i) => ({ name: `x${i}`, amount: null })) }), TODAY)).toBe('items');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 1000, note: 'Gas', split: 'equal', items: [{ name: 'x', amount: null }] }), TODAY)).toBe('bad');
    expect(await addEntry(db, flatId, t, bz({ receipt: jpeg(250_001) }), TODAY)).toBe('receipt');
    expect(await addEntry(db, flatId, t, bz({ receipt: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) }), TODAY)).toBe('receipt');
    expect(await addEntry(db, flatId, t, e({ type: 'deposit', amount: 1000, memberId: ids.Tahsin, receipt: jpeg() }), TODAY)).toBe('receipt');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 1000, note: 'Gas', split: 'equal', receipt: jpeg(250_000) }), TODAY)).toBe('ok');   // 250 KB is the limit
    expect(await db(`select 1 from ledger where flat_id = $1`, [flatId])).toHaveLength(1);
  });

  it('remove and put back keep the item lines, the receipt and the check', async () => {
    const { flatId, ids, nafis, as, add } = await flat();
    const items = [{ name: 'Rice', amount: 50000 }, { name: 'Oil', amount: null }];
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 90000, paidBy: ids.Tahsin, items, receipt: jpeg() });
    await db(`insert into entry_checks (flat_id, ledger_id, month, state, by_member) values ($1, $2, $3::text::date, 'ok', $4)`, [flatId, id, OCT, ids.Nafis]);
    expect(await removeEntry(db, flatId, nafis, id, TODAY)).toBe(true);
    expect((await itemsFor(db, flatId, OCT)).has(id)).toBe(false);
    expect(await receiptOf(db, flatId, id)).not.toBeNull();
    expect(await putBack(db, flatId, ids.Nafis, id, TODAY)).toBe(true);
    expect((await itemsFor(db, flatId, OCT)).get(id)).toEqual(items);
    expect(await receiptOf(db, flatId, id)).not.toBeNull();
    expect((await loadMonth(db, flatId, OCT, TODAY)).entries.find(x => x.id === id)!.check).toBe('ok');
  });
});

describe('the check', { timeout: 30000 }, () => {
  it('a check moves no version, so a waiting handover survives it; a second tap writes nothing', async () => {
    const { flatId, ids, nafis, as, add } = await flat();
    await db(`update members set pin_hash = 'x' where flat_id = $1`, [flatId]);   // only a claimed name can take the money
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 90000, paidBy: ids.Tahsin });
    expect(await offerHandover(db, flatId, nafis, ids.Zarif, await flatMoney(db, flatId, TODAY), TODAY)).toBe('ok');
    const versions = () => db<{ m: number; o: number }>(`select (select version from months where flat_id = $1 and month = $2::text::date) as m,
      (select offer_version from flats where id = $1) as o`, [flatId, OCT]);
    const before = await versions();
    expect(await checkEntry(db, flatId, nafis, id, 'ok', null, TODAY)).toEqual({ adder: ids.Tahsin, type: 'bazar', amount: 90000 });
    expect(await versions()).toEqual(before);
    expect(await checkEntry(db, flatId, nafis, id, 'fix', 'again', TODAY)).toBeNull();
    expect(await acceptHandover(db, flatId, ids.Zarif, (await currentOffer(db, flatId))!.id)).toBe('ok');
    const log = await db<{ after: unknown }>(`select after from audit_log where flat_id = $1 and entity_id = $2 and after ? 'checked'`, [flatId, id]);
    expect(log.map(l => l.after)).toEqual([{ checked: 'ok' }]);
  });

  it('only someone may_check allows; Needs correction needs a reason and shows to the adder with it', async () => {
    const { flatId, ids, nafis, as, add } = await flat();
    const fund = await add(nafis, { type: 'bazar', amount: 50000 });   // flat money: the collector's own spending
    const own = await add(as('Tahsin'), { type: 'bazar', amount: 30000, paidBy: ids.Tahsin, date: '2026-10-06' });
    expect((await toCheck(db, flatId, ids.Nafis, TODAY)).map(c => c.id)).toEqual([own]);
    expect((await toCheck(db, flatId, ids.Zarif, TODAY)).map(c => c.id)).toEqual([fund]);
    expect(await checkEntry(db, flatId, nafis, fund, 'ok', null, TODAY)).toBeNull();          // never their own spending
    expect(await checkEntry(db, flatId, as('Zarif'), own, 'ok', null, TODAY)).toBeNull();     // the collector's to check
    expect(await checkEntry(db, flatId, nafis, own, 'fix', '  ', TODAY)).toBeNull();         // a reason is required
    expect(await checkEntry(db, flatId, nafis, own, 'fix', 'Rice was ৳500', TODAY)).toEqual({ adder: ids.Tahsin, type: 'bazar', amount: 30000 });
    expect(await toCheck(db, flatId, ids.Tahsin, TODAY)).toEqual([
      expect.objectContaining({ id: fund, state: null }), expect.objectContaining({ id: own, state: 'fix', reason: 'Rice was ৳500' })]);
    expect(await checkEntry(db, flatId, as('Tahsin'), fund, 'ok', null, TODAY)).not.toBeNull();
    expect(await toCheck(db, flatId, ids.Zarif, TODAY)).toEqual([]);
    const [a] = await db<{ after: unknown }>(`select after from audit_log where entity_id = $1 and after ? 'checked'`, [own]);
    expect(a.after).toEqual({ checked: 'fix', note: 'Rice was ৳500' });
  });

  it('a check needs its month open: nothing lands on a closed month', async () => {
    const { flatId, ids, nafis, as, add } = await flat(['Tahsin', 'Zarif'], '2026-09-01');
    const id = await add(nafis, { type: 'bazar', amount: 1000, date: '2026-09-05', paidBy: ids.Tahsin });   // a late entry, by the collector
    expect(await checkEntry(db, flatId, as('Zarif'), id, 'ok', null, TODAY)).not.toBeNull();
    const info = (await closeInfo(db, flatId, TODAY))!;
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', TODAY, { cash: info.held, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    await db(`delete from entry_checks where ledger_id = $1`, [id]);   // as if never checked
    expect(await checkEntry(db, flatId, as('Zarif'), id, 'ok', null, TODAY)).toBeNull();
    expect(await db(`select 1 from entry_checks where ledger_id = $1`, [id])).toHaveLength(0);
    expect(await toCheck(db, flatId, ids.Zarif, TODAY)).toEqual([]);
  });

  it('the entry page reads items, receipt, check and whether I may check it', async () => {
    const { flatId, ids, nafis, as, add } = await flat();
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 90000, paidBy: ids.Tahsin, items: [{ name: 'Rice', amount: 50000 }], receipt: jpeg() });
    const mine = (await entryDetail(db, flatId, id, ids.Nafis, TODAY))!;
    expect(mine.d).toMatchObject({ type: 'bazar', amount: 90000, open: true, check: null, mayCheck: true, addedBy: 'Tahsin', items: [{ name: 'Rice', amount: 50000 }] });
    expect(mine.d.receiptV).toMatch(/^\d+$/);
    expect(mine.people.map(p => p.name)).toEqual(['Nafis', 'Tahsin', 'Zarif']);
    expect((await entryDetail(db, flatId, id, ids.Zarif, TODAY))!.d.mayCheck).toBe(false);
    await checkEntry(db, flatId, nafis, id, 'fix', 'Rice was ৳450', TODAY);
    expect((await entryDetail(db, flatId, id, ids.Tahsin, TODAY))!.d).toMatchObject({ check: 'fix', reason: 'Rice was ৳450', checkedBy: 'Nafis' });
    expect((await entryDetail(db, flatId, id, ids.Nafis, TODAY))!.d.mayCheck).toBe(false);   // checked already: nothing to tap
    expect(await entryDetail(db, flatId, randomUUID(), ids.Nafis, TODAY)).toBeNull();
  });

  it('the entry page offers no check on a closed month', async () => {
    const { flatId, ids, nafis, add } = await flat(['Tahsin', 'Zarif'], '2026-09-01');
    const id = await add(nafis, { type: 'bazar', amount: 1000, date: '2026-09-05', paidBy: ids.Tahsin });
    expect((await entryDetail(db, flatId, id, ids.Zarif, TODAY))!.d.mayCheck).toBe(true);
    const info = (await closeInfo(db, flatId, TODAY))!;
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', TODAY, { cash: info.held, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    expect((await entryDetail(db, flatId, id, ids.Zarif, TODAY))!.d.mayCheck).toBe(false);
  });

  it('a Needs correction reason is cleaned like any typed text', async () => {
    const { flatId, ids, nafis, as, add } = await flat();
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 1000, paidBy: ids.Tahsin });
    expect(await checkEntry(db, flatId, nafis, id, 'fix', '‮​', TODAY)).toBeNull();   // nothing left once cleaned
    expect(await checkEntry(db, flatId, nafis, id, 'fix', ' Rice‮ was ৳500\u0007 ', TODAY)).not.toBeNull();
    expect((await entryDetail(db, flatId, id, ids.Tahsin, TODAY))!.d.reason).toBe('Rice was ৳500');
  });
});

describe('Fix it', { timeout: 30000 }, () => {
  const version = (flatId: string) => db<{ v: number }>(`select version as v from months where flat_id = $1 and month = $2::text::date`, [flatId, OCT]).then(r => r[0].v);

  it('only from Needs correction, only by whoever added it or the collector; back to waiting with before and after', async () => {
    const { flatId, ids, nafis, as, add, may } = await flat();
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 100000, paidBy: ids.Tahsin, receipt: jpeg(),
      items: [{ name: 'Rice', amount: 60000 }, { name: 'Dal', amount: 20000 }, { name: 'Oil', amount: null }] });
    const fix = (p: Partial<Fix> = {}): Fix => ({ id, amount: 90000, date: '2026-10-06', paidBy: ids.Tahsin, note: 'fixed', items: [{ name: 'Rice', amount: 60000 }], receipt: null, ...p });
    expect((await fixEntry(db, flatId, as('Tahsin'), fix(), TODAY)).result).toBe('bad');   // waiting: nothing to fix
    await checkEntry(db, flatId, nafis, id, 'fix', 'Rice was ৳500', TODAY);
    expect((await fixEntry(db, flatId, as('Zarif'), fix(), TODAY)).result).toBe('bad');    // not theirs
    expect((await fixEntry(db, flatId, as('Tahsin'), fix({ date: '2026-09-30' }), TODAY)).result).toBe('date');   // another month
    expect((await fixEntry(db, flatId, as('Tahsin'), fix({ date: '2026-10-10' }), TODAY)).result).toBe('date');   // after today
    expect((await fixEntry(db, flatId, as('Tahsin'), fix({ amount: 50000 }), TODAY)).result).toBe('items');
    const v0 = await version(flatId);
    expect(await fixEntry(db, flatId, as('Tahsin'), fix(), TODAY)).toEqual({ result: 'ok', marker: ids.Nafis, type: 'bazar', amount: 90000 });
    expect(await version(flatId)).toBeGreaterThan(v0);   // money moved: a close prepared before it is refused
    const [l] = await db<{ amount: number; date: string; note: string }>(`select amount_poisha::int as amount, date::text as date, note from ledger where id = $1`, [id]);
    expect(l).toEqual({ amount: 90000, date: '2026-10-06', note: 'fixed' });
    expect(await db(`select 1 from entry_checks where ledger_id = $1`, [id])).toHaveLength(0);   // waiting again
    expect((await itemsFor(db, flatId, OCT)).get(id)).toEqual([{ name: 'Rice', amount: 60000 }]);
    expect(await receiptOf(db, flatId, id)).not.toBeNull();   // no new photo: the old one stays
    const [a] = await db<{ before: { amount_poisha: number; items: unknown[] }; after: { amount_poisha: number; items: unknown[]; fixed: boolean } }>(
      `select before, after from audit_log where entity_id = $1 and after ? 'fixed'`, [id]);
    expect([a.before.amount_poisha, a.before.items.length, a.after.amount_poisha, a.after.items.length, a.after.fixed]).toEqual([100000, 3, 90000, 1, true]);
    expect((await fixEntry(db, flatId, as('Tahsin'), fix(), TODAY)).result).toBe('bad');   // waiting again: one fix per correction
    expect(await may(id, 'Nafis')).toBe(true);   // Tahsin fixed it: still the collector's to check
  });

  it('a fix by the collector makes it theirs: another flatmate checks it next', async () => {
    const { flatId, ids, nafis, as, add, may } = await flat();
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 1000, paidBy: ids.Tahsin });
    await checkEntry(db, flatId, nafis, id, 'fix', 'wrong day', TODAY);
    expect((await fixEntry(db, flatId, nafis, { id, amount: 1000, date: '2026-10-04', paidBy: ids.Tahsin, note: null, items: [], receipt: null }, TODAY)).result).toBe('ok');
    expect([await may(id, 'Nafis'), await may(id, 'Tahsin'), await may(id, 'Zarif')]).toEqual([false, false, true]);
  });

  it('a bill keeps its split; a new receipt replaces the old; a payer who had left by then is refused', async () => {
    const { flatId, ids, nafis, as, add } = await flat();
    const id = await add(as('Tahsin'), { type: 'bill', amount: 2000, note: 'Gas', split: 'selected', selected: [ids.Tahsin, ids.Zarif], paidBy: ids.Tahsin, receipt: jpeg() });
    await checkEntry(db, flatId, nafis, id, 'fix', 'amount', TODAY);
    const f: Fix = { id, amount: 2500, date: '2026-10-05', paidBy: ids.Tahsin, note: 'Gas', items: [], receipt: jpeg(200) };
    expect((await fixEntry(db, flatId, as('Tahsin'), { ...f, note: null }, TODAY)).result).toBe('bad');                     // a bill keeps a name
    expect((await fixEntry(db, flatId, as('Tahsin'), { ...f, items: [{ name: 'x', amount: null }] }, TODAY)).result).toBe('bad');
    await db(`update members set left_on = '2026-10-03' where id = $1`, [ids.Zarif]);
    expect((await fixEntry(db, flatId, as('Tahsin'), { ...f, paidBy: ids.Zarif }, TODAY)).result).toBe('gone');
    expect((await fixEntry(db, flatId, as('Tahsin'), f, TODAY)).result).toBe('ok');
    expect((await db<{ m: string }>(`select member_id as m from bill_split_members where ledger_id = $1 order by member_id`, [id])).map(r => r.m)).toEqual([ids.Tahsin, ids.Zarif].sort());
    expect((await receiptOf(db, flatId, id))!.length).toBe(200);
  });

  it('a new receipt gets a new version, so phones fetch the new photo; no new receipt keeps the version', async () => {
    const { flatId, ids, nafis, as, add } = await flat();
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 1000, paidBy: ids.Tahsin, receipt: jpeg() });
    await db(`update receipts set created_at = created_at - interval '1 hour' where ledger_id = $1`, [id]);   // added an hour ago
    const v = async () => (await entryDetail(db, flatId, id, ids.Tahsin, TODAY))!.d.receiptV!;
    const f: Fix = { id, amount: 1000, date: '2026-10-05', paidBy: ids.Tahsin, note: null, items: [], receipt: null };
    const v0 = await v();
    await checkEntry(db, flatId, nafis, id, 'fix', 'photo', TODAY);
    expect((await fixEntry(db, flatId, as('Tahsin'), f, TODAY)).result).toBe('ok');
    expect(await v()).toBe(v0);
    await checkEntry(db, flatId, nafis, id, 'fix', 'photo', TODAY);
    expect((await fixEntry(db, flatId, as('Tahsin'), { ...f, receipt: jpeg(150) }, TODAY)).result).toBe('ok');
    expect(Number(await v())).toBeGreaterThan(Number(v0));
  });

  it('a receipt that is not a small JPEG is refused', async () => {
    const { flatId, ids, nafis, as, add } = await flat();
    const id = await add(as('Tahsin'), { type: 'bazar', amount: 1000, paidBy: ids.Tahsin });
    await checkEntry(db, flatId, nafis, id, 'fix', 'photo', TODAY);
    const f: Fix = { id, amount: 1000, date: '2026-10-05', paidBy: ids.Tahsin, note: null, items: [], receipt: jpeg(250_001) };
    expect((await fixEntry(db, flatId, as('Tahsin'), f, TODAY)).result).toBe('receipt');
    expect((await fixEntry(db, flatId, as('Tahsin'), { ...f, amount: 0, receipt: null }, TODAY)).result).toBe('bad');
    expect(await db(`select 1 from entry_checks where ledger_id = $1`, [id])).toHaveLength(1);   // still sent back
  });

  it('a month closed since it was sent back: the database refuses (month_closed) and nothing changes', async () => {
    const { flatId, ids, nafis, as, add } = await flat(['Tahsin', 'Zarif'], '2026-09-01');
    const id = await add(nafis, { type: 'bazar', amount: 1000, date: '2026-09-05', paidBy: ids.Tahsin });
    await checkEntry(db, flatId, as('Zarif'), id, 'fix', 'amount', TODAY);
    const info = (await closeInfo(db, flatId, TODAY))!;
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', TODAY, { cash: info.held, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    await expect(fixEntry(db, flatId, nafis, { id, amount: 900, date: '2026-09-05', paidBy: ids.Tahsin, note: null, items: [], receipt: null }, TODAY))
      .rejects.toThrow('month_closed');
    expect(await db(`select 1 from entry_checks where ledger_id = $1 and state = 'fix'`, [id])).toHaveLength(1);
    expect((await db<{ a: number }>(`select amount_poisha::int as a from ledger where id = $1`, [id]))[0].a).toBe(1000);
  });
});
