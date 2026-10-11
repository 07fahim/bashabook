import { foodSplit } from '../../../lib/money';
import type { loadMonth } from '../../../lib/money-db';
import type { Dict } from '../dictionaries';
import { fmtDay, fmtExact, fmtMeals, fmtMonth, fmtTaka } from '../format';

type Month = Awaited<ReturnType<typeof loadMonth>>;
export type Row = { label: string; value: string; kind?: 'head' | 'sub' | 'total' };
/** The words for "How this adds up": the viewer's own ("Your meals") or someone else's ("Meals"). */
export type Labels = { meals: string; share: string; deposited: string; spent: string; received: string; paidIn: string };

/** '+৳500' / '−৳300', so the breakdown reads as a sum; no sign on ৳0. */
const signed = (sign: '+' | '−', p: number) => `${p ? sign : ''}${fmtTaka(p)}`;

/** One person's "How this adds up" for one month, from the same numbers the Money page shows: the screen and the Share text
 *  both come from these rows, so they can't disagree. A closed month has only its snapshot: no guest or per-bill lines.
 *  Null if the person has no row this month. */
export function breakdownOf(mo: Month, id: string, x: Dict['money'], l: Labels, broughtFrom: string) {
  const r = mo.result.perMember.find(p => p.id === id);
  if (!r) return null;
  const closed = mo.info?.status === 'closed';
  const ok = mo.entries.filter(e => e.status === 'ok');
  const sum = (f: (e: Month['entries'][number]) => boolean) => ok.filter(f).reduce((a, e) => a + e.amount, 0);
  const myMeals = mo.meals.get(id) ?? 0, myGuests = mo.guestMeals.get(id) ?? 0;
  // this month's bazar share; a correction for a closed month is its own line, split by that month's meals
  const bazarShare = mo.result.lines.filter(ln => ln.memberId === id && ln.rowId === 'bazar').reduce((a, ln) => a + ln.amount, 0);
  const guestFood = foodSplit(bazarShare, myMeals, myGuests).guests;   // own + guests = bazar share, tested
  const meals = (h: number) => (h === 100 ? x.mealsOne : x.mealsN).replace('{n}', fmtMeals(h));
  const bills = mo.result.lines.filter(ln => ln.memberId === id && ln.rowId !== 'bazar').map(line => {
    const e = mo.entries.find(e => e.id === line.rowId), note = e?.note ?? x.types.bill;
    return { label: e?.forMonth ? `${x.correctionFor.replace('{month}', fmtMonth(e.forMonth))} · ${note}` : note, value: fmtTaka(line.amount) };
  });
  const rows: Row[] = [
    ...(r.opening !== 0 ? [{ label: x.broughtFrom.replace('{month}', fmtMonth(broughtFrom)), value: `${r.opening < 0 ? '−' : '+'}${fmtTaka(r.opening)}`, kind: 'head' as const }] : []),
    { label: l.share, value: signed('−', r.foodCost + r.billShare), kind: 'head' },
    { label: `${l.meals} · ${meals(myMeals - myGuests)}`, value: fmtTaka(closed ? r.foodCost : bazarShare - guestFood), kind: 'sub' },
    ...(myGuests > 0 ? [{ label: `${x.guestMeals} · ${meals(myGuests)}`, value: fmtTaka(guestFood), kind: 'sub' as const }] : []),
    ...(closed ? (r.billShare > 0 ? [{ label: x.bills, value: fmtTaka(r.billShare), kind: 'sub' as const }] : [])
      : bills.map(b => ({ ...b, kind: 'sub' as const }))),
    ...(closed ? [{ label: l.paidIn, value: signed('+', r.paidIn) }] : [
      { label: l.deposited, value: signed('+', sum(e => e.type === 'deposit' && e.memberId === id)) },
      { label: l.spent, value: signed('+', sum(e => e.type !== 'deposit' && e.type !== 'payout' && e.paidBy === id)) },
    ]),
    { label: l.received, value: signed('−', r.payouts) },
    ...(r.adjustments !== 0 ? [{ label: x.adjustments, value: `${r.adjustments < 0 ? '−' : '+'}${fmtTaka(r.adjustments)}` }] : []),
    // the balance to the poisha, as settle-up shows it, so a shared amount never differs from it by a few poisha
    { label: x.balance, value: `${r.balance < 0 ? '−' : ''}${fmtExact(r.balance)}`, kind: 'total' },
  ];
  return { rows, balance: r.balance };
}

/** The text the collector shares for one person: who owes or gets back what, every line, and whether it can still change
 *  (an open month: provisional, with the date) or is final (a closed month). */
export function breakdownText(flatName: string, month: string, name: string, b: { rows: Row[]; balance: number }, closed: boolean,
  today: string, x: Dict['money'], lang: 'bn' | 'en') {
  const o = x.of, t = fmtExact(b.balance);
  const head = b.balance < 0 ? o.owes.replace('{name}', name).replace('{t}', t)
    : b.balance > 0 ? o.gets.replace('{name}', name).replace('{t}', t) : o.even.replace('{name}', name);
  return [`${flatName} · ${fmtMonth(month)}`, head, '',
    ...b.rows.map(r => `${r.kind === 'sub' ? '  ' : ''}${r.label}: ${r.value}`), '',
    closed ? o.final.replace('{month}', fmtMonth(month)) : o.soFar.replace('{d}', fmtDay(today, lang)).replace('{month}', fmtMonth(month))].join('\n');
}
