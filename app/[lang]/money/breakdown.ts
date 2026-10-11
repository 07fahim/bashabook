import { foodSplit } from '../../../lib/money';
import type { loadMonth } from '../../../lib/money-db';
import type { Dict } from '../dictionaries';
import { fmtDay, fmtExact, fmtMeals, fmtMonth, fmtTaka } from '../format';

type Month = Awaited<ReturnType<typeof loadMonth>>;
export type Row = { label: string; value: string; kind?: 'head' | 'sub' | 'total' };
/** The words for "How this adds up": the viewer's own ("Your meals") or someone else's ("Meals"). */
export type Labels = { meals: string; share: string; deposited: string; spent: string; received: string; paidIn: string };

/** Whose breakdown the page shows: someone else's only for the collector, never their own id, and only a person in this flat's
 *  month (so never anyone from another flat); anyone else, or an unknown id, gets their own. */
export const pickWho = (boss: boolean, me: string, who: unknown, here: { id: string }[]) =>
  boss && typeof who === 'string' && who !== me && here.some(p => p.id === who) ? who : null;


/** One person's "How this adds up" for one month, from the same numbers the Money page shows: the screen and the Share text
 *  both come from these rows, so they can't disagree. A closed month has only its snapshot: no guest or per-bill lines.
 *  Null if the person has no row this month. */
export function breakdownOf(mo: Month, id: string, x: Dict['money'], l: Labels, broughtFrom: string, exact = false) {
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
  // one formatter for every row: exact (shared, to settle) or whole taka (the own card); a sign only on a number that shows
  const fm = exact ? fmtExact : fmtTaka, shown = (p: number) => (exact ? p !== 0 : Math.round(Math.abs(p) / 100) !== 0);
  const signed = (sign: '+' | '−', p: number) => `${shown(p) ? sign : ''}${fm(p)}`;
  const bills = mo.result.lines.filter(ln => ln.memberId === id && ln.rowId !== 'bazar').map(line => {
    const e = mo.entries.find(e => e.id === line.rowId), note = e?.note ?? x.types.bill;
    return { label: e?.forMonth ? `${x.correctionFor.replace('{month}', fmtMonth(e.forMonth))} · ${note}` : note, value: fm(line.amount) };
  });
  const rows: Row[] = [
    ...(r.opening !== 0 ? [{ label: x.broughtFrom.replace('{month}', fmtMonth(broughtFrom)), value: `${shown(r.opening) ? (r.opening < 0 ? '−' : '+') : ''}${fm(r.opening)}`, kind: 'head' as const }] : []),
    { label: l.share, value: signed('−', r.foodCost + r.billShare), kind: 'head' },
    { label: `${l.meals} · ${meals(myMeals - myGuests)}`, value: fm(closed ? r.foodCost : bazarShare - guestFood), kind: 'sub' },
    ...(myGuests > 0 ? [{ label: `${x.guestMeals} · ${meals(myGuests)}`, value: fm(guestFood), kind: 'sub' as const }] : []),
    ...(closed ? (r.billShare > 0 ? [{ label: x.bills, value: fm(r.billShare), kind: 'sub' as const }] : [])
      : bills.map(b => ({ ...b, kind: 'sub' as const }))),
    ...(closed ? [{ label: l.paidIn, value: signed('+', r.paidIn) }] : [
      { label: l.deposited, value: signed('+', sum(e => e.type === 'deposit' && e.memberId === id)) },
      { label: l.spent, value: signed('+', sum(e => e.type !== 'deposit' && e.type !== 'payout' && e.paidBy === id)) },
    ]),
    { label: l.received, value: signed('−', r.payouts) },
    ...(r.adjustments !== 0 ? [{ label: x.adjustments, value: `${shown(r.adjustments) ? (r.adjustments < 0 ? '−' : '+') : ''}${fm(r.adjustments)}` }] : []),
    // `exact`: to the poisha, like settle-up, for a breakdown that gets shared to settle; otherwise whole taka like the headline
    { label: x.balance, value: `${shown(r.balance) && r.balance < 0 ? '−' : ''}${fm(r.balance)}`, kind: 'total' },
  ];
  return { rows, balance: r.balance };
}

/** The text the collector shares for one person: who owes or gets back what, every line, and whether it can still change
 *  (an open month: provisional, with the date) or is final (a closed month). */
export function breakdownText(flatName: string, month: string, name: string, b: { rows: Row[]; balance: number }, closed: boolean,
  today: string, x: Dict['money'], lang: 'bn' | 'en', earlierOpen: string | null = null, collector = '') {
  const o = x.of, t = fmtExact(b.balance);
  const head = b.balance < 0 ? o.owes.replace('{name}', name).replace('{t}', t)
    : b.balance > 0 ? o.gets.replace('{name}', name).replace('{t}', t) : o.even.replace('{name}', name);
  return [`${flatName} · ${fmtMonth(month)}`, head, '',
    ...b.rows.map(r => `${r.kind === 'sub' ? '  ' : ''}${r.label}: ${r.value}`), '',
    // while an earlier month is open this month starts from ৳0: say so, or the reader takes it for the whole amount
    ...(earlierOpen && !closed ? [x.notClosedYet.replace('{month}', fmtMonth(earlierOpen)).replace('{name}', collector)] : []),
    closed ? o.final.replace('{month}', fmtMonth(month)) : o.soFar.replace('{d}', fmtDay(today, lang)).replace('{month}', fmtMonth(month))].join('\n');
}
