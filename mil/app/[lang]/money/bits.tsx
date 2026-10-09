import type { toConfirm } from '@/lib/money-db';
import { confirmAction } from '../actions';
import type { Dict, Locale } from '../dictionaries';
import { fmtDay, fmtTaka } from '../format';
import { LongList, secondary } from '../ui';

/** 'You get back ৳380 so far' in leaf, 'You owe ৳210 so far' in chili. */
export const balanceText = (x: Dict['money'], balance: number) =>
  balance > 0 ? { text: x.getBack.replace('{t}', fmtTaka(balance)), tone: 'text-leaf' }
  : balance < 0 ? { text: x.owe.replace('{t}', fmtTaka(balance)), tone: 'text-chili' }
  : { text: x.even, tone: '' };

/** Money waiting for this person's tap: shown on Home, Money and the Flat tab until confirmed. */
/** Pending money piles up if nobody taps: the first three, then Show all, so it never pushes a page down. */
export function ConfirmList({ lang, x, a, items, collector }: {
  lang: Locale; x: Dict['money']; a: Dict['app']; items: Awaited<ReturnType<typeof toConfirm>>; collector: string;
}) {
  if (!items.length) return null;
  return (
    <section className="rounded-3xl border-2 border-turmeric bg-surface p-5">
      <h2 className="text-xl font-bold">{x.waitingTitle}</h2>
      <LongList label={x.waitingTitle} keep={3} more={a.showAll.replace('{n}', String(items.length))} less={a.showLess} items={items.map(w => (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span>
              {(w.type === 'payout' ? x.confirmGot.replace('{name}', collector) : x.confirmDeposit.replace('{name}', w.name)).replace('{t}', fmtTaka(w.amount))}
              <span className="block text-[15px] text-muted">{fmtDay(w.date, lang)}{w.note ? ` · ${w.note}` : ''}</span>
            </span>
            <form action={confirmAction}>
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="id" value={w.id} />
              <button className={`${secondary} md:w-auto`}>{w.type === 'payout' ? x.confirmYes : x.confirm}</button>
            </form>
          </li>
        ))} />
    </section>
  );
}
