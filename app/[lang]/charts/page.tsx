import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { costRows, lastMonths, spendByKind } from '@/lib/charts';
import { db } from '@/lib/db';
import { addDays, daysOfMonth, todayDhaka } from '@/lib/meals';
import { loadMonth, monthOf } from '@/lib/money-db';
import { noticeCount } from '@/lib/notices';
import { requireMember } from '@/lib/session';
import { HBars, Stacked, VBars } from '../bars';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtMeals, fmtMonth, fmtRate, fmtTaka } from '../format';
import { Header, withQuery } from '../header';
import { balanceText } from '../money/bits';
import { Nav } from '../nav';
import { card, focus, PageSkeleton } from '../ui';

export default function Charts({ params, searchParams }: PageProps<'/[lang]/charts'>) {
  return <Suspense fallback={<PageSkeleton />}><Body params={params} searchParams={searchParams} /></Suspense>;
}

const short = (month: string) => new Date(`${month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

/** The month as bars: the same numbers as Money and Meals, read in ten seconds. A flatmate's page carries their own food,
 *  bills and paid-in only; the cost card with everyone's is rendered for the collector alone. */
async function Body({ params, searchParams }: Pick<PageProps<'/[lang]/charts'>, 'params' | 'searchParams'>) {
  const { lang } = await params;
  const sp = await searchParams;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), x = t.charts, boss = me.role === 'manager';
  const noticesP = noticeCount(db, me.flatId, me.memberId, boss);
  const today = todayDhaka(), thisMonth = monthOf(today);
  const asked = typeof sp.m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m) ? `${sp.m}-01` : thisMonth;
  const month = asked > thisMonth ? thisMonth : asked;
  const [mo, past] = await Promise.all([loadMonth(db, me.flatId, month, today), lastMonths(db, me.flatId, month)]);
  const closed = mo.info?.status === 'closed';
  const name = (id: string) => mo.all.find(p => p.id === id)?.name ?? '?';
  const prev = monthOf(addDays(month, -1)), next = addDays(daysOfMonth(month).at(-1)!, 1);
  const href = (m: string) => `/${lang}/charts${m !== thisMonth ? `?m=${m.slice(0, 7)}` : ''}`;
  const arrow = `inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-muted font-semibold hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 ${focus}`;

  const mine = mo.result.perMember.find(p => p.id === me.memberId);
  const here = mo.members.some(p => p.id === me.memberId);
  const spend = spendByKind(mo.entries, x.others).map(r => ({ ...r, label: r.label === 'bazar' ? x.bazar : r.label }));
  const totalMeals = [...mo.meals.values()].reduce((a, b) => a + b, 0);
  const meals = mo.members.map(p => ({ id: p.id, meals: mo.meals.get(p.id) ?? 0, guests: mo.guestMeals.get(p.id) ?? 0 })).sort((a, b) => b.meals - a.meals);
  const empty = spend.every(r => r.value === 0) && totalMeals === 0;
  const h2 = 'font-display text-xl font-bold';
  const b = mine && here ? balanceText(t.money, mine.balance, closed) : null;

  return (
    <>
      <Header t={t} lang={lang} path={withQuery('/charts', sp)} notices={await noticesP}><Nav t={t} lang={lang} current="charts" showFlat={boss} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-5xl md:px-8 md:pt-10 md:pb-16">
        <nav aria-label={t.money.monthNav} className="flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold">{fmtMonth(month)}</h1>
          <span className="flex gap-2">
            {/* at the ends a plain span, not a link: keyboard users cannot follow a link that only looks disabled */}
            {month <= mo.first ? <span aria-disabled="true" aria-label={t.money.prevMonth} className={arrow}>←</span>
              : <Link href={href(prev)} aria-label={t.money.prevMonth} className={arrow}>←</Link>}
            {month >= thisMonth ? <span aria-disabled="true" aria-label={t.money.nextMonth} className={arrow}>→</span>
              : <Link href={href(next)} aria-label={t.money.nextMonth} className={arrow}>→</Link>}
          </span>
        </nav>
        {empty && <p role="status" className="mt-4 text-muted">{x.none}</p>}
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <section className={card}>
            <h2 className={h2}>{x.myMonth}</h2>
            {mine && b ? (<>
              <div className="mt-4"><Stacked fmt={fmtTaka} parts={[
                { key: 'food', label: x.food, value: mine.foodCost, color: 'fill-turmeric', swatch: 'bg-turmeric' },
                { key: 'bills', label: x.bills, value: mine.billShare, color: 'fill-muted', swatch: 'bg-muted' },
                { key: 'paid', label: x.paidIn, value: mine.paidIn, color: 'fill-leaf', swatch: 'bg-leaf' }]} /></div>
              <p className={`mt-4 font-semibold ${b.tone}`}>{b.text}</p>
            </>) : <p className="mt-2 text-muted">{t.money.notHere}</p>}
          </section>
          <section className={card}>
            <h2 className={h2}>{x.whereWent}</h2>
            <div className="mt-4"><HBars fmt={fmtTaka} rows={spend.map(r => ({ key: r.label, label: r.label, text: r.label, value: r.value }))} /></div>
            <p className="mt-4 text-[15px] text-muted">{x.rate}: {fmtRate(mo.result.mealRate, totalMeals)}</p>
          </section>
          <section className={card}>
            <h2 className={h2}>{x.mealsPer}</h2>
            <div className="mt-4"><HBars fmt={fmtMeals} rows={meals.map(p => ({
              key: p.id, text: name(p.id), value: p.meals, tail: p.guests, strong: p.id === me.memberId,
              label: <>{name(p.id)}{p.guests > 0 && <span className="ml-1 text-[13px] text-muted">{x.guests.replace('{n}', fmtMeals(p.guests))}</span>}</> }))} /></div>
          </section>
          <section className={card}>
            <h2 className={h2}>{x.lastMonths}</h2>
            {past.length < 2 ? <p className="mt-2 text-muted">{x.needTwo}</p> : (
              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <div><h3 className="font-semibold">{x.rate}</h3><div className="mt-2"><VBars fmt={v => fmtRate(v, 1)} cols={past.map(p => ({ key: p.month, label: short(p.month), value: p.rate }))} /></div></div>
                <div><h3 className="font-semibold">{x.spend}</h3><div className="mt-2"><VBars fmt={fmtTaka} cols={past.map(p => ({ key: p.month, label: short(p.month), value: p.spend }))} /></div></div>
              </div>)}
          </section>
          {boss && (
            <section className={`${card} md:col-span-2`}>
              <h2 className={h2}>{x.costPer}</h2>
              <p className="mt-1 text-[15px] text-muted">{x.costHint}</p>
              <div className="mt-4"><HBars fmt={fmtTaka} tailColor="fill-muted" rows={costRows(mo.result.perMember).map(r => ({
                key: r.id, text: name(r.id), value: r.food, tail: r.bills, valueText: fmtTaka(r.food + r.bills), strong: r.id === me.memberId,
                label: <Link className={`underline-offset-4 hover:underline ${focus}`} href={`/${lang}/money?${new URLSearchParams({ ...(month !== thisMonth ? { m: month.slice(0, 7) } : {}), who: r.id })}`}>{name(r.id)}</Link> }))} /></div>
              <p className="mt-3 text-[13px] text-muted"><span aria-hidden="true" className="mr-1 inline-block size-3 rounded-sm bg-turmeric" />{x.food} <span aria-hidden="true" className="mr-1 ml-3 inline-block size-3 rounded-sm bg-muted" />{x.bills}</p>
            </section>)}
        </div>
      </main>
    </>
  );
}
