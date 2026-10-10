import type { toConfirm } from '@/lib/money-db';
import { confirmAction } from '../actions';
import type { Dict, Locale } from '../dictionaries';
import { fmtDay, fmtTaka } from '../format';
import { LongList, secondary } from '../ui';

/** 'You get back ৳380 so far' in leaf, 'You owe ৳210 so far' in chili; a closed month drops 'so far'. */
export const balanceText = (x: Dict['money'], balance: number, closed = false) => {
  const c = closed ? x.final : x;
  return balance > 0 ? { text: c.getBack.replace('{t}', fmtTaka(balance)), tone: 'text-leaf' }
    : balance < 0 ? { text: c.owe.replace('{t}', fmtTaka(balance)), tone: 'text-chili' }
    : { text: c.even, tone: '' };
};

/** Money waiting for this person's tap: shown on Home, Money and the Flat tab until confirmed. */
/** Pending money piles up if nobody taps: phones show three, then Show all; wider screens about three rows that scroll. Either
 *  way it never pushes the page's balances down. */
/** `fill`: on wider screens the card takes its column's full height and the list scrolls inside it (the Flat tab). */
export function ConfirmList({ lang, x, a, items, collector, fill }: {
  lang: Locale; x: Dict['money']; a: Dict['app']; items: Awaited<ReturnType<typeof toConfirm>>; collector: string; fill?: boolean;
}) {
  if (!items.length) return null;
  return (
    <section className={`rounded-3xl border-2 border-turmeric bg-surface p-5 ${fill ? 'md:flex md:h-full md:flex-col' : ''}`}>
      {/* the count: on wider screens the list scrolls inside its card and Show all (n) is a phone-only control */}
      <h2 className="text-xl font-bold">{x.waitingTitle} ({items.length})</h2>
      <LongList short fill={fill} label={x.waitingTitle} keep={3} more={a.showAll.replace('{n}', String(items.length))} less={a.showLess} items={items.map(w => (
          <li key={w.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span>
              {/* paidTo: who actually handed it out, never relabelled to the current collector after a handover */}
              {(w.type === 'payout' ? x.confirmGot.replace('{name}', w.paidTo ?? collector)
                : w.paidTo ? x.confirmDepositTo.replace('{name}', w.name).replace('{to}', w.paidTo) : x.confirmDeposit.replace('{name}', w.name)).replace('{t}', fmtTaka(w.amount))}
              <span className="block text-[15px] text-muted">{fmtDay(w.date, lang)}{w.note ? ` · ${w.note}` : ''}</span>
            </span>
            <form action={confirmAction}>
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="id" value={w.id} />
              <button className={`${secondary} sm:w-auto`}>{w.type === 'payout' ? x.confirmYes : x.confirm}</button>
            </form>
          </li>
        ))} />
    </section>
  );
}
