import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { itemsFor, monthTotals } from '@/lib/bazar';
import { db } from '@/lib/db';
import { addDays, daysOfMonth, todayDhaka } from '@/lib/meals';
import { loadMonth, monthOf, type Entry } from '@/lib/money-db';
import { noticeCount } from '@/lib/notices';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../../action-form';
import { entryAction } from '../../actions';
import { DateField } from '../../date-field';
import { getDictionary, hasLocale } from '../../dictionaries';
import { fmtDay, fmtExact, fmtMonth, fmtTaka } from '../../format';
import { Header, withQuery } from '../../header';
import { ItemLines } from '../../item-lines';
import { Nav } from '../../nav';
import { PayerSelect } from '../../payer-select';
import { ReceiptPicker } from '../../receipt-picker';
import { card, Field, Fold, focus, link, LongList, PageSkeleton, primary } from '../../ui';
import { StatusChip } from '../bits';

export default function BazarList({ params, searchParams }: PageProps<'/[lang]/money/bazar'>) {
  return <Suspense fallback={<PageSkeleton />}><Body params={params} searchParams={searchParams} /></Suspense>;
}

// date and buyer with what was bought | amount | receipt | check: a table on wider screens, one card per row on phones. The
// fixed columns fit a 7-digit amount, View receipt and Needs correction in both languages and leave the first column at
// least 200 px on a 768 px tablet, where the list has the full width.
const cols = 'md:grid-cols-[minmax(0,1fr)_7rem_8rem_10rem]';

async function Body({ params, searchParams }: Pick<PageProps<'/[lang]/money/bazar'>, 'params' | 'searchParams'>) {
  const { lang } = await params;
  const sp = await searchParams;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), x = t.money, b = x.bazar, boss = me.role === 'manager';
  const noticesP = noticeCount(db, me.flatId, me.memberId, boss);
  const today = todayDhaka(), thisMonth = monthOf(today);
  const asked = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? `${sp.m}-01` : thisMonth;
  const month = asked > thisMonth ? thisMonth : asked;
  const only = sp.f === 'waiting' || sp.f === 'fix' ? sp.f : null;
  const [mo, items] = await Promise.all([loadMonth(db, me.flatId, month, today), itemsFor(db, me.flatId, month)]);
  const name = (id: string | null) => mo.all.find(p => p.id === id)?.name ?? '?';
  const collector = mo.all.find(p => p.role === 'manager')!;
  const bazars = mo.entries.filter(e => e.type === 'bazar');
  const waiting = bazars.filter(e => !e.check), fixing = bazars.filter(e => e.check === 'fix');
  const shown = only === 'waiting' ? waiting : only === 'fix' ? fixing : bazars;
  const href = (m: string, f: string | null) => `/${lang}/money/bazar?${new URLSearchParams({ ...(m !== thisMonth ? { m: m.slice(0, 7) } : {}), ...(f ? { f } : {}) })}`;
  const prev = monthOf(addDays(month, -1)), next = addDays(daysOfMonth(month).at(-1)!, 1);
  const arrow = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-muted font-semibold hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 ${focus}`;
  const pill = (on: boolean) => `inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 font-semibold ${on ? 'border-turmeric bg-turmeric text-on-turmeric' : 'border-muted'} ${focus}`;
  // the same rule as Money's forms: this month for everyone; an earlier month still open for the collector only
  const open = month === thisMonth ? mo.info?.status !== 'closed' : boss && mo.info?.status === 'open';
  const total = monthTotals(mo.entries).bazar;
  const [dFrom, dTo] = month === thisMonth ? [thisMonth, today] : [month, daysOfMonth(month).at(-1)!];
  const row = (e: Entry) => {
    const its = items.get(e.id) ?? [];
    // a correction counts for an earlier month, so the Total bazar tile leaves it out: its label says why
    const what = [e.forMonth && x.correctionFor.replace('{month}', fmtMonth(e.forMonth)),
      its.length ? `${its.slice(0, 3).map(i => i.name).join(' · ')}${its.length > 3 ? ` +${its.length - 3}` : ''}` : e.note].filter(Boolean).join(' · ');
    return (
      <li key={e.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-3 md:grid md:gap-4 md:py-2 ${cols}`}>
        <Link href={`/${lang}/money/bazar/${e.id}`} className={`flex min-h-11 min-w-0 basis-full flex-col justify-center rounded-lg md:basis-auto ${focus}`}>
          <span className="font-semibold text-turmeric-ink">{fmtDay(e.date, lang)} · {e.paidBy ? name(e.paidBy) : b.fund}</span>
          {what && <span className="block text-[15px] [overflow-wrap:anywhere]">{what}</span>}
        </Link>
        <span className="font-bold tabular-nums md:text-right">{fmtExact(e.amount)}</span>
        {e.receiptV ? <a href={`/api/receipt/${e.id}?v=${e.receiptV}`} target="_blank" rel="noopener" aria-label={`${b.viewReceipt}: ${x.types[e.type]} ${fmtExact(e.amount)}, ${fmtDay(e.date, lang)} (${b.newTab})`}
          className={`inline-flex min-h-11 items-center ${link}`}>{b.viewReceipt}</a>
          : <span className="text-[15px] text-muted">{b.noReceipt}</span>}
        <span><StatusChip state={e.check} b={b} /></span>
      </li>
    );
  };

  return (
    <>
      <Header t={t} lang={lang} path={withQuery('/money/bazar', sp)} notices={await noticesP}><Nav t={t} lang={lang} topic={me.liveTopic} current="money" showFlat={boss} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        <Link href={`/${lang}/money${month !== thisMonth ? `?m=${month.slice(0, 7)}` : ''}`} className={`inline-flex min-h-11 items-center ${link}`}>{b.backMoney}</Link>
        <nav aria-label={x.monthNav} className="flex items-center justify-between gap-3">
          {/* a phone puts the month on its own line, so no line starts with the dot; under 375 px a smaller size keeps each part on one line beside the arrows */}
          <h1 className="font-display text-3xl font-bold max-[399px]:text-2xl max-[374px]:text-xl">{b.list}<span className="block sm:inline"><span className="hidden sm:inline"> · </span>{fmtMonth(month)}</span></h1>
          <span className="flex gap-2">
            {month <= mo.first ? <span aria-disabled="true" aria-label={x.prevMonth} className={arrow}>←</span>
              : <Link href={href(prev, only)} aria-label={x.prevMonth} className={arrow}>←</Link>}
            {month >= thisMonth ? <span aria-disabled="true" aria-label={x.nextMonth} className={arrow}>→</span>
              : <Link href={href(next, only)} aria-label={x.nextMonth} className={arrow}>→</Link>}
          </span>
        </nav>
        {mo.info?.status === 'closed' && <p className="mt-2 text-muted">{b.closedNote}</p>}
        {/* one column at every width: the month's figures as a strip, Add bazar folded, then the list at full width, so no
            column ends far above its neighbour */}
        <div className="mt-6 flex flex-col gap-6 [&>details]:mt-0">
          {/* figures only: the pills on the list are the filter. Five across only from 1024 px, where a 7-digit total fits */}
          <dl className={`grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 ${card}`}>
            {([[x.totalBazar, fmtTaka(total), ''], [b.count, String(bazars.length), ''],
              [b.withReceipt, b.nOfN.replace('{n}', String(bazars.filter(e => e.receiptV).length)).replace('{m}', String(bazars.length)), ''],
              [b.waiting, String(waiting.length), ''], [b.fix, String(fixing.length), fixing.length ? 'text-chili' : '']] as const).map(([k, v, tone], i) => (
              <div key={k} className={`min-w-0 rounded-xl bg-paper p-3 ${i === 0 ? 'col-span-2 sm:col-span-1' : i === 4 ? 'sm:col-span-2 lg:col-span-1' : ''}`}>
                <dt className="text-[15px] text-muted">{k}</dt>
                <dd className={`text-xl font-bold tabular-nums [overflow-wrap:anywhere] xl:text-2xl ${tone}`}>{v}</dd>
              </div>
            ))}
          </dl>
          {open && (
            <Fold title={x.addBazar} lead={x.bazarLead}>
              <ActionForm action={entryAction} className="mt-4 md:max-w-xl" clearOnDone>
                <input type="hidden" name="lang" value={lang} /><input type="hidden" name="type" value="bazar" /><input type="hidden" name="key" value={randomUUID()} />
                <Field label={x.amount} name="amount" inputMode="decimal" required placeholder="2450" />
                <DateField lang={lang} label={x.date} name="date" required min={dFrom} max={dTo} defaultValue={dTo} />
                <PayerSelect label={x.whoPaidShop} fundLabel={x.flatMoney.replace('{name}', collector.name)} today={dTo} initial={boss ? 'fund' : me.memberId}
                  people={mo.members.filter(p => p.id !== collector.id).map(p => ({ id: p.id, name: p.name, joinedOn: p.joinedOn, leftOn: p.leftOn }))} />
                <ItemLines title={b.itemsTitle} hint={b.itemsHint} name={b.itemName} amount={b.itemAmount} add={b.addItem} />
                <ReceiptPicker label={b.addReceipt} change={b.changeReceipt} added={b.receiptAdded} failed={b.receiptFailed} hint={b.receiptHint} />
                <Field label={x.note} name="note" maxLength={100} />
                <button className={primary}>{x.save}</button>
              </ActionForm>
            </Fold>
          )}
          <section className={card}>
            <nav aria-label={b.filterLabel} className="flex flex-wrap gap-2">
              {([[null, b.all, bazars.length], ['waiting', b.waiting, waiting.length], ['fix', b.fix, fixing.length]] as const).map(([f, label, n]) => (
                <Link key={label} href={href(month, f)} aria-current={only === f ? 'true' : undefined} className={pill(only === f)}>{label} ({n})</Link>
              ))}
            </nav>
            {!shown.length ? <p className="mt-3 text-muted">{bazars.length ? b.noMatch : b.noBazar}</p> : (
              <LongList screen label={b.list} keep={10} more={t.app.showAll.replace('{n}', String(shown.length))} less={t.app.showLess} items={shown.map(row)}
                head={<div aria-hidden="true" className={`hidden gap-4 border-b border-line pb-2 text-[15px] text-muted md:grid ${cols}`}>
                  <span>{b.what}</span><span className="text-right">{x.amount}</span><span>{b.receipt}</span><span>{b.status}</span>
                </div>} />
            )}
          </section>
        </div>
      </main>
    </>
  );
}
