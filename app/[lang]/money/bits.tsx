import Link from 'next/link';
import type { toCheck } from '@/lib/bazar';
import type { Look } from '@/lib/charts';
import type { toConfirm } from '@/lib/money-db';
import { confirmAction, rejectAction } from '../actions';
import type { Dict, Locale } from '../dictionaries';
import { fmtDay, fmtExact, fmtTaka } from '../format';
import { PendingButton } from '../pending-button';
import { alertCard, focus, link, LongList, secondary } from '../ui';

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
      <LongList short fill={fill} label={x.waitingTitle} keep={3} more={a.showAll.replace('{n}', String(items.length))} less={a.showLess} items={items.map(w => {
        // paidTo: who actually handed it out, never relabelled to the current collector after a handover
        const who = w.type === 'payout' ? w.paidTo ?? collector : w.name;
        const line = w.type === 'payout' ? x.confirmGot.replace('{name}', who)
          : w.forMe ? x.confirmGave.replace('{name}', w.name)
          : w.paidTo ? x.confirmDepositTo.replace('{name}', w.name).replace('{to}', w.paidTo) : x.confirmDeposit.replace('{name}', w.name);
        const yes = w.forMe ? x.confirmGaveYes : w.type === 'payout' || !w.paidTo ? x.confirmYes : x.confirm;
        const sr = <span className="sr-only">: {who}, {fmtExact(w.amount)}</span>;
        return (
          <li key={w.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span>
              {line.replace('{t}', fmtExact(w.amount))}
              <span className="block text-[15px] text-muted">{[fmtDay(w.date, lang), w.method && x.cashMethods[w.method], w.note].filter(Boolean).join(' · ')}</span>
            </span>
            {/* the buttons are the flex child: without shrink-0 a long name squeezes them and a label wraps */}
            <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row">
              <form action={confirmAction}>
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="id" value={w.id} />
                <PendingButton className={`${secondary} sm:w-auto`}>{yes}{sr}</PendingButton>
              </form>
              <form action={rejectAction}>
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="id" value={w.id} />
                <PendingButton className={`flex min-h-12 w-full items-center justify-center rounded-full border border-chili bg-surface px-6 font-semibold text-chili hover:bg-paper sm:w-auto ${focus}`}>{x.notRight}{sr}</PendingButton>
              </form>
            </div>
          </li>
        );
      })} />
    </section>
  );
}

/** A bazar's or bill's check state as a chip: the word says it, the colour only repeats it. */
export const StatusChip = ({ state, b }: { state: 'ok' | 'fix' | null; b: Dict['money']['bazar'] }) => (
  <span className={`inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[15px] font-semibold ${state === 'ok' ? 'border-leaf text-leaf' : state === 'fix' ? 'border-chili text-chili' : 'border-muted'}`}>
    {state === 'ok' ? b.ok : state === 'fix' ? b.fix : b.waiting}
  </span>
);

/** Bazars and bills for this person: to check, or their own sent back to fix (with the reason). Each opens its page. Shown
 *  on Home and Money beside Waiting for you; like it, three rows on phones, a short scroll box on wider screens. */
export function CheckList({ lang, x, a, items }: { lang: Locale; x: Dict['money']; a: Dict['app']; items: Awaited<ReturnType<typeof toCheck>> }) {
  if (!items.length) return null;
  const b = x.bazar;
  return (
    <section className={alertCard}>
      <h2 className="text-xl font-bold">{b.checkTitle} ({items.length})</h2>
      <LongList short label={b.checkTitle} keep={3} more={a.showAll.replace('{n}', String(items.length))} less={a.showLess} items={items.map(c => (
        <li key={c.id} className="py-2">
          <Link href={`/${lang}/money/bazar/${c.id}`} className={`inline-flex min-h-11 items-center ${link}`}>{x.types[c.type]} · {fmtExact(c.amount)}</Link>
          <span className="block text-[15px] text-muted [overflow-wrap:anywhere]">
            {[fmtDay(c.date, lang), c.state === 'fix' ? b.toFix.replace('{reason}', c.reason ?? '') : b.toCheck, c.note].filter(Boolean).join(' · ')}
          </span>
        </li>
      ))} />
    </section>
  );
}
