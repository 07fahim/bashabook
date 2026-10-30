import Link from 'next/link';
import { ActionForm } from './action-form';
import { closeAction, coverGapAction } from './actions';
import { CashCount } from './cash-count';
import type { Look } from '@/lib/charts';
import type { Dict, Locale } from './dictionaries';
import { fmtDate, fmtExact, fmtMonth, fmtSigned } from './format';
import { alertCard, link, primary, secondary } from './ui';

/** `fund`: the month's own fund (below 0 = its gap is paid first); `held`: the cash to count, every open month's money now. */
export type CloseInfo = { month: string; fund: number; held: number; later: number; pending: number; due: number; pendingMonth: string; problems: number; looks: Look[]; unchecked: number; anywayFrom: string; anyway: boolean };

/** The collector's card for the oldest finished month: what blocks it, or the cash count and Close. */
/** `collector`: the collector's name (the signed-in person: only they see this card). */
/** `warn`: the look-over questions about this month, already worded (lookText); they never block. */
export function CloseCard({ lang, x, c, collector, warn }: { lang: Locale; x: Dict['money']; c: CloseInfo; collector: string; warn: string[] }) {
  const gap = fmtExact(c.fund), name = fmtMonth(c.month), blocked = c.pending > 0 || c.problems > 0;
  // bazars and bills not Verified: before the 4th they are in the pending line; from then on the month closes without them
  const anyway = c.unchecked > 0 && (c.anyway ? (c.unchecked === 1 ? x.anywayNowOne : x.anywayNow.replace('{n}', String(c.unchecked)))
    : x.anywayLater.replace('{d}', fmtDate(c.anywayFrom)));
  // @container: full width on Money, one column on Flat; when wide, the four boxes sit in a row and text keeps a readable measure
  return (
    <section className={`@container ${alertCard}`}>
      <h2 className="text-xl font-bold">{x.closeTitle.replace('{month}', name)}</h2>
      <p className="mt-1 max-w-prose text-muted">{x.closeLead}</p>
      {warn.length > 0 && (
        <div className="mt-4 max-w-prose">
          <h3 className="font-semibold">{x.closeLook}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px]">
            {warn.map((w, i) => <li key={i}><Link href={`/${lang}/money?m=${c.month.slice(0, 7)}#entries`} className={`inline-flex min-h-11 items-center ${link}`}>{w}</Link></li>)}
          </ul>
          <p className="mt-1 text-[15px] text-muted">{x.closeLookHint}</p>
        </div>
      )}
      {blocked ? (<>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {c.due > 0 && (
            <li>
              {(c.due === 1 ? x.blockDueOne : x.blockDue.replace('{n}', String(c.due))).replace('{month}', name)}{' '}
              <Link href={`/${lang}/money?m=${c.month.slice(0, 7)}`} className={`inline-flex min-h-11 items-center ${link}`}>{x.fixIt}</Link>
            </li>
          )}
          {c.pending > c.due && (
            <li>
              {c.pending - c.due === 1 ? x.blockPendingOne : x.blockPending.replace('{n}', String(c.pending - c.due))}{' '}
              <Link href={`/${lang}/money?m=${c.pendingMonth.slice(0, 7)}`} className={`inline-flex min-h-11 items-center ${link}`}>{x.fixIt}</Link>
              <span className="block text-[15px] text-muted">{x.blockPayout}</span>
            </li>
          )}
          {c.problems > 0 && <li>{x.blockProblems}</li>}
        </ul>
        {anyway && <p className="mt-2 max-w-prose text-[15px]">{anyway}</p>}
      </>) : c.fund < 0 ? (
        // nothing to count below ৳0. If the collector paid the gap themselves it becomes their deposit first: two taps, as Remove
        <div className="mt-4">
          <p className="max-w-prose font-semibold">{x.coverLead.replaceAll('{t}', gap)}</p>
          <details className="mt-4">
            <summary className={`${secondary} @xl:inline-flex @xl:w-auto cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{x.coverBtn.replace('{t}', gap)}</summary>
            <ActionForm action={coverGapAction} className="mt-4">
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="shown" value={-c.fund} />
              <p>{x.coverAsk.replace('{t}', gap)}</p>
              <button className={`${primary} @xl:w-auto`}>{x.coverYes}</button>
            </ActionForm>
          </details>
        </div>
      ) : (
        <ActionForm action={closeAction} className="mt-4">
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="month" value={c.month} />
          <p className="font-semibold">{x.expected.replace('{t}', fmtSigned(c.held))}</p>
          {c.later !== 0 && <p className="max-w-prose text-[15px] text-muted">{x.heldSplit.replace('{month}', name).replace('{a}', fmtSigned(c.fund)).replace('{b}', fmtSigned(c.later))}</p>}
          {/* spent past what the flat held: the rest came from the collector's own pocket, so there is nothing more to count */}
          {c.fund + c.later < 0 && <p className="max-w-prose text-[15px] font-semibold">{x.flatOwes.replace('{name}', collector).replace('{t}', fmtExact(-(c.fund + c.later)))}</p>}
          {anyway && <p className="max-w-prose text-[15px]">{anyway}</p>}
          <CashCount x={x} fund={c.held} />
          <button className={`${primary} @xl:w-auto`}>{x.closeBtn.replace('{month}', name)}</button>
        </ActionForm>
      )}
    </section>
  );
}
