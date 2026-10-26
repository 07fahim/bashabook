import type { Look } from '@/lib/charts';
import type { toConfirm } from '@/lib/money-db';
import { confirmAction } from '../actions';
import type { Dict, Locale } from '../dictionaries';
import { fmtDay, fmtExact, fmtTaka } from '../format';
import { PendingButton } from '../pending-button';
import { alertCard, LongList, secondary } from '../ui';

/** 'You get back ৳380 so far' in leaf, 'You owe ৳210 so far' in chili; a closed month drops 'so far'. */
export const balanceText = (x: Dict['money'], balance: number, closed = false) => {
  const c = closed ? x.final : x;
  const r = Math.round(Math.abs(balance) / 100);   // the headline is whole taka: under 50 poisha either way reads as even, not as "owe ৳0"
  return r && balance > 0 ? { text: c.getBack.replace('{t}', fmtTaka(balance)), tone: 'text-leaf' }
    : r && balance < 0 ? { text: c.owe.replace('{t}', fmtTaka(balance)), tone: 'text-chili' }
    : { text: c.even, tone: '' };
};

/** A look-over question as one sentence: the day as Money shows it, the amount exact, a bill by its name. */
export const lookText = (t: Dict, lang: Locale, l: Look) => l.kind === 'dup'
  ? t.charts.lookDup.replace('{d}', fmtDay(l.date, lang)).replace('{t}', fmtExact(l.amount)).replace('{type}', `${t.money.types[l.type].toLowerCase()}${l.note ? ` ${l.note}` : ''}`).replace('{n}', String(l.n))
  : l.kind === 'high' ? t.charts.lookHigh.replace('{d}', fmtDay(l.date, lang)).replace('{t}', fmtExact(l.amount)).replace('{m}', fmtExact(l.max))
  : t.charts.lookMissing.replace('{note}', l.note).replace('{day}', String(l.day));

/** Money waiting for this person's tap: shown on Home, Money and the Flat tab until confirmed. */
/** Pending money piles up if nobody taps: phones show three, then Show all; wider screens about three rows that scroll. Either
 *  way it never pushes the page's balances down. */
/** `fill`: on wider screens the card takes its column's full height and the list scrolls inside it (the Flat tab). */
export function ConfirmList({ lang, x, a, items, collector, fill }: {
  lang: Locale; x: Dict['money']; a: Dict['app']; items: Awaited<ReturnType<typeof toConfirm>>; collector: string; fill?: boolean;
}) {
  if (!items.length) return null;
  return (
    <section className={`${alertCard} ${fill ? 'md:flex md:h-full md:flex-col' : ''}`}>
      {/* the count: on wider screens the list scrolls inside its card and Show all (n) is a phone-only control */}
      <h2 className="text-xl font-bold">{x.waitingTitle} ({items.length})</h2>
      <LongList short fill={fill} label={x.waitingTitle} keep={3} more={a.showAll.replace('{n}', String(items.length))} less={a.showLess} items={items.map(w => (
          <li key={w.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span>
              {/* paidTo: who actually handed it out, never relabelled to the current collector after a handover */}
              {(w.type === 'payout' ? x.confirmGot.replace('{name}', w.paidTo ?? collector)
                : w.paidTo ? x.confirmDepositTo.replace('{name}', w.name).replace('{to}', w.paidTo) : x.confirmDeposit.replace('{name}', w.name)).replace('{t}', fmtExact(w.amount))}
              <span className="block text-[15px] text-muted">{[fmtDay(w.date, lang), w.method && x.cashMethods[w.method], w.note].filter(Boolean).join(' · ')}</span>
            </span>
            {/* the form is the flex child: without shrink-0 a long name squeezes it and the button's label wraps */}
            <form action={confirmAction} className="sm:shrink-0">
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="id" value={w.id} />
              <PendingButton className={`${secondary} sm:w-auto`}>{w.type === 'payout' || !w.paidTo ? x.confirmYes : x.confirm}<span className="sr-only">: {w.type === 'payout' ? w.paidTo ?? collector : w.name}, {fmtExact(w.amount)}</span></PendingButton>
            </form>
          </li>
        ))} />
    </section>
  );
}
