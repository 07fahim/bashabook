import type { Db } from './db';
import type { MemberResult } from './money';
import type { Entry } from './money-db';

/** Bazar first, then this month's bills grouped by their note, biggest first; after 8 bills the rest add up under `others`.
 *  Only saved rows of the month itself: a correction for an earlier month belongs to that month, as with the meal rate. */
export function spendByKind(entries: Entry[], others: string) {
  const ok = entries.filter(e => e.status === 'ok' && !e.forMonth);
  const bazar = ok.filter(e => e.type === 'bazar').reduce((a, e) => a + e.amount, 0);
  const byNote = new Map<string, number>();
  for (const e of ok) if (e.type === 'bill') { const k = e.note?.trim() || others; byNote.set(k, (byNote.get(k) ?? 0) + e.amount); }
  const bills = [...byNote].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const rest = bills.slice(8).reduce((a, r) => a + r.value, 0);
  return [{ label: 'bazar', value: bazar }, ...bills.slice(0, 8), ...(rest ? [{ label: others, value: rest }] : [])];
}

/** Each closed month before `before`, oldest first: its frozen meal rate and what the flat spent (saved bazar and bills of the
 *  month itself; a correction booked later for an earlier month stays out, as in spendByKind). */
export const lastMonths = (db: Db, flatId: string, before: string, n = 6) => db<{ month: string; rate: number; spend: number }>(
  `select month::text as month, coalesce(meal_rate, 0)::int as rate,
          (select coalesce(sum(amount_poisha), 0)::int from ledger l where l.flat_id = m.flat_id and l.month = m.month and l.status = 'ok' and l.type in ('bazar', 'bill') and l.for_month is null) as spend
     from (select * from months where flat_id = $1 and status = 'closed' and month < $2 order by month desc limit $3::int) m order by month`,
  [flatId, before, n]);

/** The collector's card: food and bills per person, biggest first; nobody with nothing. */
export const costRows = (perMember: MemberResult[]) => perMember
  .map(p => ({ id: p.id, food: p.foodCost, bills: p.billShare })).filter(r => r.food + r.bills > 0).sort((a, b) => b.food + b.bills - a.food - a.bills);
