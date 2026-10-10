import Link from 'next/link';
import { ActionForm } from './action-form';
import { closeAction, coverGapAction } from './actions';
import { CashCount } from './cash-count';
import type { Dict, Locale } from './dictionaries';
import { fmtExact, fmtMonth, fmtSigned } from './format';
import { link, primary, secondary } from './ui';

export type CloseInfo = { month: string; fund: number; pending: number; problems: number; earlierOpen: string | null };

/** The collector's card for the oldest finished month: what blocks it, or the cash count and Close. */
/** `collector`: the collector's name (the signed-in person: only they see this card). */
export function CloseCard({ lang, x, c, collector }: { lang: Locale; x: Dict['money']; c: CloseInfo; collector: string }) {
  const gap = fmtExact(c.fund), name = fmtMonth(c.month), blocked = c.pending > 0 || c.problems > 0 || c.earlierOpen !== null;
  return (
    <section className="rounded-3xl border-2 border-turmeric bg-surface p-5">
      <h2 className="text-xl font-bold">{x.closeTitle.replace('{month}', name)}</h2>
      <p className="mt-1 text-muted">{x.closeLead}</p>
      {blocked ? (
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {c.earlierOpen && <li>{x.blockEarlier.replace('{month}', fmtMonth(c.earlierOpen))}</li>}
          {c.pending > 0 && (
            <li>
              {x.blockPending.replace('{n}', String(c.pending))}{' '}
              <Link href={`/${lang}/money?m=${c.month.slice(0, 7)}`} className={`inline-flex min-h-11 items-center ${link}`}>{x.fixIt}</Link>
              <span className="block text-[15px] text-muted">{x.blockPayout}</span>
            </li>
          )}
          {c.problems > 0 && <li>{x.blockProblems}</li>}
        </ul>
      ) : c.fund < 0 ? (
        // nothing to count below ৳0. If the collector paid the gap themselves it becomes their deposit first: two taps, as Remove
        <div className="mt-4">
          <p className="font-semibold">{x.coverLead.replaceAll('{name}', collector).replaceAll('{t}', gap)}</p>
          <details className="mt-4">
            <summary className={`${secondary} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{x.coverBtn.replace('{t}', gap)}</summary>
            <ActionForm action={coverGapAction} className="mt-4">
              <input type="hidden" name="lang" value={lang} />
              <p>{x.coverAsk.replace('{t}', gap).replace('{name}', collector)}</p>
              <button className={primary}>{x.coverYes}</button>
            </ActionForm>
          </details>
        </div>
      ) : (
        <ActionForm action={closeAction} className="mt-4">
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="month" value={c.month} />
          <p className="font-semibold">{x.expected.replace('{t}', fmtSigned(c.fund))}</p>
          <CashCount x={x} fund={c.fund} />
          <button className={primary}>{x.closeBtn.replace('{month}', name)}</button>
        </ActionForm>
      )}
    </section>
  );
}
