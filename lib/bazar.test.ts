import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, migrate, pg } from '../db/test-db';
import { createFlat } from './auth';
import { addEntry, openMonth, type Actor, type NewEntry } from './money-db';

const OCT = '2026-10-01', TODAY = '2026-10-09';
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-10-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
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
