import { describe, it, expect } from 'vitest';
import { checkAll, confirmAll, db, migrate } from '../db/test-db';
import { getDictionary } from '../app/[lang]/dictionaries';
import { breakdownOf, breakdownText, pickWho, type Labels } from '../app/[lang]/money/breakdown';
import { createFlat } from './auth';
import { closeMonth } from './close';
import { flatMoney } from './handover';
import { addEntry, loadMonth, openMonth, type NewEntry } from './money-db';

// The collector opens and shares someone else's "How this adds up". September: Tahsin deposits ৳3,000; ৳1,800 bazar from flat
// money; Electricity ৳900 split equally by the three. Everyone eats the usual three meals a day (breakfast counts half: 75
// meals each), so the bazar splits equally too.
const SEP = '2026-09-01', OCT2 = '2026-10-02';
const x = getDictionary('en').money;
const own: Labels = { meals: x.myMeals, share: x.share, deposited: x.deposited, spent: x.spent, received: x.received, paidIn: x.paidIn };
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: SEP, lang: 'en' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  await openMonth(db, f.flatId, SEP);
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 300000, memberId: ids.Tahsin }))).toBe('ok');
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'bazar', amount: 180000 }))).toBe('ok');
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'bill', amount: 90000, note: 'Electricity', split: 'equal' }))).toBe('ok');
  await confirmAll(f.flatId);   // Tahsin's Yes on the Money received
  await openMonth(db, f.flatId, '2026-10-01');
  return { flatId: f.flatId, ids, nafis };
}
const rowsOf = (b: ReturnType<typeof breakdownOf>) => b!.rows.map(r => [r.label, r.value]);

describe('someone else’s breakdown, shared by the collector', { timeout: 30000 }, () => {
  it('open month: Tahsin’s lines in neutral words, each bill by name, and the text says it can still change', async () => {
    const { flatId, ids } = await flat();
    const mo = await loadMonth(db, flatId, SEP, OCT2);
    const b = breakdownOf(mo, ids.Tahsin, x, x.of, SEP);
    expect(rowsOf(b)).toEqual([
      ['Share of costs', '−৳900'], ['Meals · 75 meals', '৳600'], ['Electricity', '৳300'],
      ['Deposited', '+৳3,000'], ['Spent for the flat', '৳0'], ['Got from flat money', '৳0'], ['Balance', '৳2,100']]);
    expect(b!.balance).toBe(210000);
    const text = breakdownText('Flat 4B', SEP, 'Tahsin', b!, false, OCT2, x, 'en');
    expect(text.split('\n')).toEqual(['Flat 4B · September 2026', 'Tahsin gets back ৳2,100 from the flat', '',
      'Share of costs: −৳900', '  Meals · 75 meals: ৳600', '  Electricity: ৳300', 'Deposited: +৳3,000', 'Spent for the flat: ৳0',
      'Got from flat money: ৳0', 'Balance: ৳2,100', '', 'So far, as of Fri, 2 October. It can still change until September 2026 is closed.']);
  });

  it('the viewer’s own breakdown keeps “Your” words; the numbers are the same', async () => {
    const { flatId, ids } = await flat();
    const mo = await loadMonth(db, flatId, SEP, OCT2);
    const mine = breakdownOf(mo, ids.Zarif, x, own, SEP)!, theirs = breakdownOf(mo, ids.Zarif, x, x.of, SEP)!;
    expect(mine.rows.map(r => r.value)).toEqual(theirs.rows.map(r => r.value));
    expect(mine.rows[1].label).toBe('Your meals · 75 meals');
    expect(rowsOf(theirs).at(-1)).toEqual(['Balance', '−৳900']);
    expect(breakdownText('Flat 4B', SEP, 'Zarif', theirs, false, OCT2, x, 'en').split('\n')[1]).toBe('Zarif owes the flat ৳900');
  });

  it('closed month: from the frozen snapshot, and the text says it is final', async () => {
    const { flatId, ids, nafis } = await flat();
    const held = await flatMoney(db, flatId, OCT2);
    await checkAll(flatId);
    expect((await closeMonth(db, flatId, nafis, SEP, OCT2, { cash: held, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    const mo = await loadMonth(db, flatId, SEP, OCT2);
    const b = breakdownOf(mo, ids.Tahsin, x, x.of, SEP);
    expect(rowsOf(b)).toEqual([
      ['Share of costs', '−৳900'], ['Meals · 75 meals', '৳600'], ['Bill share', '৳300'],
      ['Paid in (deposits and spending)', '+৳3,000'], ['Got from flat money', '৳0'], ['Balance', '৳2,100']]);
    expect(breakdownText('Flat 4B', SEP, 'Tahsin', b!, true, OCT2, x, 'en').split('\n').at(-1)).toBe('September 2026 is closed: these numbers are final.');
    // October carries it: the next month opens with Tahsin's ৳2,100 brought forward
    const oct = breakdownOf(await loadMonth(db, flatId, '2026-10-01', OCT2), ids.Tahsin, x, x.of, SEP)!;
    expect(oct.rows[0]).toEqual({ label: 'Brought from September 2026', value: '+৳2,100', kind: 'head' });
  });

  it('a shared breakdown is to the poisha, as settle-up is; the viewer’s own card stays in whole taka like its headline', async () => {
    const { flatId, ids, nafis } = await flat();
    expect(await addEntry(db, flatId, nafis, e({ type: 'bill', amount: 10000, note: 'Water', split: 'equal' }))).toBe('ok');   // ৳100 by three
    const mo = await loadMonth(db, flatId, SEP, OCT2);
    const shared = breakdownOf(mo, ids.Tahsin, x, x.of, SEP, true)!, mine = breakdownOf(mo, ids.Tahsin, x, own, SEP)!;
    expect(shared.balance % 100).not.toBe(0);
    const exact = `৳${(shared.balance / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    expect(shared.rows.at(-1)!.value).toBe(exact);
    expect(breakdownText('Flat 4B', SEP, 'Tahsin', shared, false, OCT2, x, 'en').split('\n')[1]).toBe(`Tahsin gets back ${exact} from the flat`);
    expect(mine.rows.at(-1)!.value).toBe(`৳${Math.round(shared.balance / 100).toLocaleString('en-US')}`);
  });

  it('while an earlier month is open, the shared text says it isn’t included yet', async () => {
    const { flatId, ids } = await flat();
    const oct = await loadMonth(db, flatId, '2026-10-01', OCT2);
    expect(oct.earlierOpen).toBe(SEP);
    const b = breakdownOf(oct, ids.Tahsin, x, x.of, SEP, true) ?? { rows: [], balance: 0 };
    const lines = breakdownText('Flat 4B', '2026-10-01', 'Tahsin', b, false, OCT2, x, 'en', oct.earlierOpen, 'Nafis').split('\n');
    expect(lines.at(-2)).toBe('September 2026 isn’t closed yet. Its balances will be added here when Nafis closes it.');
  });

  it('only the collector opens someone else’s, never their own id, and only someone in this month', () => {
    const here = [{ id: 'a' }, { id: 'b' }];
    expect(pickWho(true, 'a', 'b', here)).toBe('b');
    expect(pickWho(false, 'a', 'b', here)).toBeNull();          // a flatmate gets their own
    expect(pickWho(true, 'a', 'a', here)).toBeNull();           // the collector's own: the normal card
    expect(pickWho(true, 'a', 'z', here)).toBeNull();           // not in this month (or another flat)
    expect(pickWho(true, 'a', ['b'], here)).toBeNull();         // ?who=b&who=c arrives as a list
  });

  it('nobody outside the month: no breakdown', async () => {
    const { flatId } = await flat();
    expect(breakdownOf(await loadMonth(db, flatId, SEP, OCT2), '00000000-0000-0000-0000-000000000000', x, x.of, SEP)).toBeNull();
  });
});
