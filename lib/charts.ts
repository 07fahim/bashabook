import type { Db } from './db';
import { indexChanges, isPresent, mealCount, MEALS, type Meal, type MealChange, type MealMember } from './meals';
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

/** The flat's spend climbing through the month: for each day, every saved bazar and bill of the month dated up to it. */
export function runningSpend(entries: Entry[], days: string[]) {
  const ok = entries.filter(e => e.status === 'ok' && !e.forMonth && (e.type === 'bazar' || e.type === 'bill'));
  let sum = 0;
  return days.map(d => { sum += ok.filter(e => e.date === d).reduce((a, e) => a + e.amount, 0); return { day: d, value: sum }; });
}

/** One person's plates per meal over `days`, guests included, and how many of those were guests. */
export function myPlates(m: MealMember, changes: MealChange[], days: string[]): { meal: Meal; plates: number; guests: number }[] {
  const idx = indexChanges(changes);
  return MEALS.map(meal => ({
    meal,
    plates: days.reduce((a, d) => a + mealCount(m, idx, d, meal), 0),
    guests: changes.filter(c => c.memberId === m.id && c.meal === meal && days.includes(c.date) && isPresent(m, c.date)).reduce((a, c) => a + (c.guests ?? 0), 0),
  }));
}

/** At most five slices for a ring: the biggest named rows keep their names, everything else (including rows already called
 *  `others`) adds up under one `others` slice, so the legend never shows that word twice. */
export function slices(rows: { label: string; value: number }[], others: string, n = 5) {
  const named = rows.filter(r => r.value > 0 && r.label !== others).sort((a, b) => b.value - a.value);
  const all = rows.reduce((a, r) => a + Math.max(r.value, 0), 0), namedSum = named.reduce((a, r) => a + r.value, 0);
  const head = named.length + (all > namedSum ? 1 : 0) > n ? named.slice(0, n - 1) : named;   // at most n slices, the others slice included
  const rest = all - head.reduce((a, r) => a + r.value, 0);
  return [...head, ...(rest > 0 ? [{ label: others, value: rest }] : [])];
}

/** The month end at the bazar pace so far: `bazar` over `elapsed` of `days` days, stretched over the whole month. `meals` and
 *  `mine` are the whole month's weighted meals (the usual meals fill the days ahead). Null before a week of bazar, since one
 *  big first bazar is not a pace. Poisha; a rough guide, never a bill. */
export function forecast(bazar: number, elapsed: number, days: number, meals: number, mine: number) {
  if (elapsed < 7 || bazar <= 0 || meals <= 0) return null;
  const total = Math.round((bazar * days) / elapsed);
  return { rate: Math.round((total * 100) / meals), food: Math.round((total * mine) / meals) };
}

/** One person's bill share in a closed month, from its snapshot; null when they had no row. */
export const billShareIn = async (db: Db, flatId: string, memberId: string, month: string) =>
  (await db<{ v: number }>(`select bill_share::int as v from month_balances where flat_id = $1 and member_id = $2 and month = $3`, [flatId, memberId, month]))[0]?.v ?? null;

/** Every saved bazar and bill of the flat's last `n` closed months before `before`: the history the look-over compares against. */
export const history = (db: Db, flatId: string, before: string, n = 12) => db<{ month: string; type: 'bazar' | 'bill'; amount: number; date: string; note: string | null }>(
  `select month::text as month, type, amount_poisha::int as amount, date::text as date, note from ledger
    where flat_id = $1 and status = 'ok' and for_month is null and type in ('bazar', 'bill')
      and month in (select month from months where flat_id = $1 and status = 'closed' and month < $2 order by month desc limit $3::int) order by date`, [flatId, before, n]);

export type Look = { kind: 'dup'; type: 'bazar' | 'bill'; date: string; amount: number; note: string | null; n: number } | { kind: 'high'; date: string; amount: number; max: number } | { kind: 'missing'; note: string; day: number };
const noteKey = (n: string | null) => n?.trim().toLowerCase() ?? '';

/** Questions for the collector about the running month, never findings: the same saved bazar or bill twice on one day; a bazar
 *  bigger than any this flat saved in a closed month (after ten of them, so the first weeks do not shout); a bill note that
 *  was in by a certain day in each of the last three closed months and is not in yet. Rules only, nothing leaves the app. */
export function worthALook(entries: Entry[], past: { month: string; type: 'bazar' | 'bill'; amount: number; date: string; note: string | null }[], today: string): Look[] {
  const ok = entries.filter(e => e.status === 'ok' && !e.forMonth && (e.type === 'bazar' || e.type === 'bill'));
  const out: Look[] = [];
  // a twin shares type, day, amount, who paid, and for a bill its name: two ৳500 bills on the 1st (Wi-Fi, gas) are not twins
  const seen = new Map<string, { e: Entry; n: number }>();
  for (const e of ok) { const k = `${e.type}|${e.date}|${e.amount}|${e.paidBy ?? ''}|${e.type === 'bill' ? noteKey(e.note) : ''}`; seen.set(k, { e, n: (seen.get(k)?.n ?? 0) + 1 }); }
  for (const { e, n } of seen.values()) if (n > 1) out.push({ kind: 'dup', type: e.type as 'bazar' | 'bill', date: e.date, amount: e.amount, note: e.type === 'bill' ? e.note?.trim() ?? null : null, n });
  const bazars = past.filter(p => p.type === 'bazar').map(p => p.amount);
  if (bazars.length >= 10) { const max = Math.max(...bazars); for (const e of ok) if (e.type === 'bazar' && e.amount > max) out.push({ kind: 'high', date: e.date, amount: e.amount, max }); }
  const months = [...new Set(past.map(p => p.month))].sort().slice(-3);
  if (months.length === 3) {
    const byNote = new Map<string, { note: string; days: number[] }>();   // the note as last typed, and its latest day in each month
    for (const m of months) {
      const latest = new Map<string, { note: string; day: number }>();
      for (const p of past) if (p.month === m && p.type === 'bill' && noteKey(p.note)) {
        const k = noteKey(p.note), day = Number(p.date.slice(8));
        if ((latest.get(k)?.day ?? 0) < day) latest.set(k, { note: p.note!.trim(), day });
      }
      for (const [k, v] of latest) { const x = byNote.get(k) ?? { note: v.note, days: [] }; x.note = v.note; x.days.push(v.day); byNote.set(k, x); }
    }
    const here = new Set(ok.filter(e => e.type === 'bill').map(e => noteKey(e.note)));
    for (const [k, x] of byNote) { const day = Math.max(...x.days); if (x.days.length === 3 && !here.has(k) && Number(today.slice(8)) > day) out.push({ kind: 'missing', note: x.note, day }); }
  }
  return out;
}
