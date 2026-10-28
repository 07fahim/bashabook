import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { UUID } from '@/lib/auth';
import { entryDetail, otherItems } from '@/lib/bazar';
import { db } from '@/lib/db';
import { daysOfMonth, todayDhaka } from '@/lib/meals';
import { monthOf } from '@/lib/money-db';
import { noticeCount } from '@/lib/notices';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../../../action-form';
import { checkAction, fixAction } from '../../../actions';
import { DateField } from '../../../date-field';
import { getDictionary, hasLocale } from '../../../dictionaries';
import { dhakaDate, fmtDay, fmtExact, fmtWhen } from '../../../format';
import { Header } from '../../../header';
import { ItemLines } from '../../../item-lines';
import { Nav } from '../../../nav';
import { PayerSelect } from '../../../payer-select';
import { ReceiptPicker } from '../../../receipt-picker';
import { card, Field, focal, focus, link, PageSkeleton, primary, secondary } from '../../../ui';
import { StatusChip } from '../../bits';

export default function BazarEntry({ params, searchParams }: PageProps<'/[lang]/money/bazar/[id]'>) {
  return <Suspense fallback={<PageSkeleton />}><Body params={params} searchParams={searchParams} /></Suspense>;
}

async function Body({ params, searchParams }: Pick<PageProps<'/[lang]/money/bazar/[id]'>, 'params' | 'searchParams'>) {
  const { lang, id } = await params;
  const sp = await searchParams;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), x = t.money, b = x.bazar, boss = me.role === 'manager', today = todayDhaka();
  const noticesP = noticeCount(db, me.flatId, me.memberId, boss);
  const r = UUID.test(id) ? await entryDetail(db, me.flatId, id, me.memberId, today) : null;
  if (!r) notFound();
  const { d, people } = r;
  const name = (pid: string | null) => people.find(p => p.id === pid)?.name ?? '?';
  const collector = people.find(p => p.collector)!;
  // the buttons come from entryDetail's rules (the ones checkEntry and fixEntry keep); those decide again on save
  const other = otherItems(d.items, d.amount), end = daysOfMonth(d.month).at(-1)!;
  const q = d.month !== monthOf(today) ? `?m=${d.month.slice(0, 7)}` : '';
  const day = (at: string | null) => (at ? fmtDay(dhakaDate(at), lang) : '');
  const state = d.check === 'ok' ? (d.checkedBy ? b.checkedBy.replace('{name}', d.checkedBy).replace('{d}', day(d.checkedAt)) : b.checkedOld)
    : d.check === 'fix' ? b.fixBy.replace('{name}', d.checkedBy ?? '?').replace('{d}', day(d.checkedAt)).replace('{reason}', d.reason ?? '')
    : sp.fixed === '1' ? b.fixed : b.waitingLine;
  const src = d.receiptV ? `/api/receipt/${d.id}?v=${d.receiptV}` : null;
  const hidden = (s?: 'ok' | 'fix') => (<><input type="hidden" name="lang" value={lang} /><input type="hidden" name="id" value={d.id} />{s && <input type="hidden" name="state" value={s} />}</>);

  return (
    <>
      <Header t={t} lang={lang} path={`/money/bazar/${d.id}`} notices={await noticesP}><Nav t={t} lang={lang} current="money" showFlat={boss} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        <Link href={d.type === 'bazar' ? `/${lang}/money/bazar${q}` : `/${lang}/money${q}#entries`} className={`inline-flex min-h-11 items-center ${link}`}>{d.type === 'bazar' ? b.back : b.backMoney}</Link>
        <div className="mt-2 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <section className={focal}>
            <h1 className="font-display text-3xl font-bold">{x.types[d.type]} · {fmtExact(d.amount)}</h1>
            <p className="mt-1 text-muted [overflow-wrap:anywhere]">{[fmtDay(d.date, lang), d.paidBy ? x.paidBy.replace('{name}', name(d.paidBy)) : x.fundPaid, d.note].filter(Boolean).join(' · ')}</p>
            <p role="status" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusChip state={d.check} b={b} /><span className="[overflow-wrap:anywhere]">{state}</span>
            </p>
            {d.type === 'bazar' && (
              <div className="mt-4">
                <h2 className="font-semibold">{b.bought}</h2>
                {d.items.length ? (
                  <ul className="mt-1 divide-y divide-line">
                    {d.items.map((i, k) => (
                      <li key={k} className="flex justify-between gap-4 py-2"><span className="min-w-0 [overflow-wrap:anywhere]">{i.name}</span><span className="shrink-0 tabular-nums">{i.amount === null ? '' : fmtExact(i.amount)}</span></li>
                    ))}
                    {other > 0 && <li className="flex justify-between gap-4 py-2 text-muted"><span>{b.otherItems}</span><span className="shrink-0 tabular-nums">{fmtExact(other)}</span></li>}
                  </ul>
                ) : <p className="mt-1 text-muted">{b.noItems}</p>}
              </div>
            )}
            <p className="mt-4 text-[15px] text-muted">{b.addedBy.replace('{name}', d.addedBy).replace('{d}', fmtWhen(d.addedAt, lang))}</p>
            {!d.open && <p className="mt-3 font-semibold">{b.closedNote}</p>}
            {d.mayCheck && (
              <div className="mt-5 space-y-3">
                <ActionForm action={checkAction}>{hidden('ok')}<button className={`${primary} sm:w-auto`}>{b.ok}</button></ActionForm>
                <details>
                  <summary className={`${secondary} cursor-pointer list-none sm:inline-flex sm:w-auto [&::-webkit-details-marker]:hidden`}>{b.fix}</summary>
                  <ActionForm action={checkAction} className="mt-3">
                    {hidden('fix')}
                    <Field label={b.reason} name="note" required maxLength={100} />
                    {/* a 40-character name would wrap the pill on a 320 px phone: only the name is cut on screen (the verb stays, in
                        both word orders) and it is read out whole */}
                    <button className={primary}>{d.adderMayFix ? (
                      <span className="flex min-w-0 whitespace-pre">
                        <span>{b.sendBack.split('{name}')[0]}</span><span className="truncate">{d.addedBy}</span><span>{b.sendBack.split('{name}')[1]}</span>
                      </span>
                    ) : b.sendBackPlain}</button>
                  </ActionForm>
                </details>
              </div>
            )}
            {/* their own entry sent back, but too late for them to fix (an earlier month): say who will */}
            {d.open && d.check === 'fix' && !d.mayFix && d.createdBy === me.memberId && <p className="mt-5 font-semibold">{b.othersFix.replace('{name}', collector.name)}</p>}
            {d.mayFix && (
              <div className="mt-6 border-t border-line pt-5">
                <h2 className="text-lg font-bold">{b.fixIt}</h2>
                <p className="text-muted">{b.fixLead}</p>
                <ActionForm action={fixAction} className="mt-4">
                  {hidden()}<input type="hidden" name="type" value={d.type} />
                  {d.type === 'bill' && <Field label={x.billName} name="note" required maxLength={100} defaultValue={d.note ?? ''} />}
                  <Field label={x.amount} name="amount" inputMode="decimal" required defaultValue={String(d.amount / 100)} />
                  <DateField lang={lang} label={x.date} name="date" required min={d.month} max={today < end ? today : end} defaultValue={d.date} />
                  <PayerSelect label={d.type === 'bazar' ? x.whoPaidShop : x.whoPaidBill} fundLabel={x.flatMoney.replace('{name}', collector.name)} today={d.date}
                    initial={d.paidBy ?? 'fund'} people={people.filter(p => !p.collector || p.id === d.paidBy)} />
                  {d.type === 'bazar' && <ItemLines title={b.itemsTitle} hint={b.itemsHint} name={b.itemName} amount={b.itemAmount} add={b.addItem}
                    initial={d.items.map(i => ({ name: i.name, amount: i.amount === null ? '' : String(i.amount / 100) }))} />}
                  <ReceiptPicker label={src ? b.changeReceipt : b.addReceipt} change={b.changeReceipt} added={b.receiptAdded} failed={b.receiptFailed} />
                  {d.type === 'bazar' && <Field label={x.note} name="note" maxLength={100} defaultValue={d.note ?? ''} />}
                  <button className={primary}>{x.save}</button>
                </ActionForm>
              </div>
            )}
          </section>
          {/* beside a long Fix it form the receipt stays in view, whole: the photo is cut to the screen's height there */}
          <section className={`${card} lg:sticky lg:top-24`}>
            <h2 className="text-xl font-bold">{b.receipt}</h2>
            {src ? (
              <a href={src} target="_blank" rel="noopener" className={`mt-3 block rounded-xl ${focus}`}>
                <Image src={src} alt={b.receiptAlt} width={960} height={1280} unoptimized className="mx-auto h-auto w-full rounded-xl lg:max-h-[calc(100vh-13rem)] lg:w-auto" />
              </a>
            ) : <p className="mt-2 text-muted">{b.noReceipt}</p>}
          </section>
        </div>
      </main>
    </>
  );
}
