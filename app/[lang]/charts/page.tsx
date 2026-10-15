import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { billShareIn, costRows, forecast, lastMonths, myPlates, runningSpend, slices, spendByKind } from '@/lib/charts';
import { db } from '@/lib/db';
import { flatMoney } from '@/lib/handover';
import { addDays, daysOfMonth, todayDhaka, weightedMeals } from '@/lib/meals';
import { loadMonth, monthOf } from '@/lib/money-db';
import { noticeCount } from '@/lib/notices';
import { requireMember } from '@/lib/session';
import { Area, HBars, Ring, Stacked, VBars } from '../bars';
import { getDictionary, hasLocale, type Dict } from '../dictionaries';
import { fmtDay, fmtExact, fmtMeals, fmtMonth, fmtRate, fmtSigned, fmtTaka } from '../format';
import { Header, withQuery } from '../header';
import { balanceText } from '../money/bits';
import { Nav } from '../nav';
import { card, focus, link, PageSkeleton } from '../ui';

export default function Charts({ params, searchParams }: PageProps<'/[lang]/charts'>) {
  return <Suspense fallback={<PageSkeleton />}><Body params={params} searchParams={searchParams} /></Suspense>;
}

const short = (month: string) => new Date(`${month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const h2 = 'font-display text-xl font-bold';

/** One number with its label and a line of context: the strip across the top. */
function Tile({ label, value, note, tone = '' }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-[28px] leading-tight font-bold tabular-nums ${tone}`}>{value}</p>
      {note && <p className="mt-1 text-[13px] text-muted">{note}</p>}
    </div>
  );
}

/** '+4% vs Sept' for a closed month against the closed month before it; 'so far' while the month runs. */
function delta(x: Dict['charts'], now: number, before: number | null, month: string | null, closed: boolean) {
  if (!closed) return { note: x.soFar, tone: '' };
  if (now <= 0 || before === null || before <= 0 || month === null) return { note: undefined, tone: '' };
  const p = Math.round(((now - before) / before) * 100);
  return { note: x.vsLast.replace('{p}', `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`).replace('{month}', short(month)), tone: p > 0 ? 'text-chili' : p < 0 ? 'text-leaf' : '' };
}

/** The month as a dashboard: a strip of numbers, the spend climbing through the month, where it went, plates per day, then the
 *  cards. Same numbers as Money and Meals. A flatmate's page carries their own food, bills and paid-in only; the cost card with
 *  everyone's is rendered for the collector alone. */
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

  // the days drawn: all of a past month, this month up to today
  const days = daysOfMonth(month), running = month === thisMonth;
  const upTo = running ? days.indexOf(today) : days.length - 1;
  const mine = mo.result.perMember.find(p => p.id === me.memberId);
  const spend = spendByKind(mo.entries, x.others).map(r => ({ ...r, label: r.label === 'bazar' ? x.bazar : r.label }));
  const total = spend.reduce((a, r) => a + r.value, 0);
  const totalMeals = [...mo.meals.values()].reduce((a, b) => a + b, 0);
  const meals = mo.members.map(p => ({ id: p.id, meals: mo.meals.get(p.id) ?? 0, guests: mo.guestMeals.get(p.id) ?? 0 })).sort((a, b) => b.meals - a.meals);
  const self = mo.members.find(p => p.id === me.memberId);
  const plates = self ? myPlates(self, mo.changes, days.slice(0, upTo + 1)) : [];
  const spent = runningSpend(mo.entries, days);
  const empty = !mo.entries.some(e => e.status === 'ok') && totalMeals === 0;
  const b = mine ? balanceText(t.money, mine.balance, closed) : null;
  // money with the collector, as Money shows it (this month adds every open month up while an earlier one is still open)
  const held = running && mo.earlierOpen ? await flatMoney(db, me.flatId, today) : mo.result.fund;
  const holder = closed && mo.info?.cash ? name(mo.info.cash.by) : mo.all.find(p => p.role === 'manager')?.name ?? '';
  // the month before, for the deltas: only a closed month next to this one
  const before = past.at(-1)?.month === prev ? past.at(-1)! : null;
  const rateD = delta(x, mo.result.mealRate, before?.rate ?? null, before?.month ?? null, closed);
  const spendD = delta(x, total, before?.spend ?? null, before?.month ?? null, closed);
  const axis = [0, 1, 2, 3, 4].map(k => Math.round((k * (days.length - 1)) / 4));   // five labels where the drawn days really are
  // the month end at this pace: bazar so far stretched over the month, everyone's usual meals filling the days ahead, and my
  // bills no lower than last closed month's share (the cook's pay lands late). Only while the month runs.
  const whole = running ? weightedMeals(mo.members, mo.changes, month, mo.flat.weights) : new Map<string, number>();
  const ahead = running ? forecast(spend[0].value, upTo + 1, days.length, [...whole.values()].reduce((a, b) => a + b, 0), whole.get(me.memberId) ?? 0) : null;
  const lastBills = ahead && mine && mo.carriedFrom ? await billShareIn(db, me.flatId, me.memberId, mo.carriedFrom) : null;
  const bills = mine ? Math.max(mine.billShare, lastBills ?? 0) : 0;
  const ending = ahead && mine ? mine.opening + mine.paidIn - ahead.food - bills - mine.payouts + mine.adjustments : 0;

  return (
    <>
      <Header t={t} lang={lang} path={withQuery('/charts', sp)} notices={await noticesP}><Nav t={t} lang={lang} current="charts" showFlat={boss} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
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

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
          <div className="col-span-2 sm:col-span-1">
            {mine && b ? <Tile label={b.tone === 'text-chili' ? x.tileOwe : b.tone === 'text-leaf' ? x.tileGet : x.tileEven} value={fmtTaka(mine.balance)} note={closed ? undefined : x.soFar} tone={b.tone} />
              : <Tile label={x.myMonth} value="—" note={t.money.notHere} />}
          </div>
          <Tile label={x.rate} value={fmtRate(mo.result.mealRate, totalMeals)} note={rateD.note} tone={rateD.tone} />
          <Tile label={x.spend} value={fmtTaka(total)} note={spendD.note} tone={spendD.tone} />
          <Tile label={x.plates} value={self ? String(plates.reduce((a, p) => a + p.plates, 0)) : '—'} note={self && !closed ? x.soFar : undefined} />
          <Tile label={x.flatMoney} value={`${held < 0 ? '−' : ''}${fmtTaka(held)}`} note={x.holds.replace('{name}', holder)} tone={held < 0 ? 'text-chili' : ''} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-12 md:gap-6 lg:mt-6">
          {running && (
            <section className={`${card} md:col-span-12`}>
              <h2 className={h2}>{x.pace}</h2>
              {ahead ? (<>
                <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
                  <div><dt className="text-[13px] font-semibold text-muted">{x.rate}</dt><dd className="mt-1 text-[28px] leading-tight font-bold tabular-nums">{fmtRate(ahead.rate, 1)}</dd></div>
                  {mine && <div><dt className="text-[13px] font-semibold text-muted">{x.cost}</dt><dd className="mt-1 text-[28px] leading-tight font-bold tabular-nums">{fmtTaka(ahead.food + bills)}</dd></div>}
                </dl>
                {mine && <p className={`mt-3 text-[15px] font-semibold ${ending < 0 ? 'text-chili' : ending > 0 ? 'text-leaf' : ''}`}>{(ending < 0 ? x.paceOwe : ending > 0 ? x.paceGet : x.paceEven).replace('{t}', fmtTaka(ending))}</p>}
                <p className="mt-2 text-[13px] text-muted">{x.paceNote.replace('{d}', String(upTo + 1)).replace('{b}', lastBills !== null && lastBills > (mine?.billShare ?? 0) ? x.paceBillsLast : x.paceBillsSoFar)}</p>
              </>) : <p className="mt-2 text-muted">{x.paceWait}</p>}
            </section>)}
          <section className={`${card} md:col-span-12 lg:col-span-8`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className={h2}>{x.through}</h2>
              <p className="text-[15px] text-muted">{x.throughNote.replace('{t}', fmtTaka(spent[upTo].value)).replace('{d}', fmtDay(days[upTo], lang))}</p>
            </div>
            <div className="mt-4"><Area points={spent} upTo={upTo} running={running} /></div>
            <ol aria-hidden="true" className="mt-1 flex justify-between text-[13px] text-muted tabular-nums">
              {axis.map(i => <li key={i}>{i + 1}</li>)}
            </ol>
            {running && <p className="mt-2 text-[13px] text-muted">- - - {x.today}</p>}
          </section>
          <section className={`${card} md:col-span-12 lg:col-span-4`}>
            <h2 className={h2}>{x.whereWent}</h2>
            <div className="mt-4"><Ring fmt={fmtTaka} slices={slices(spend, x.others)} /></div>
          </section>

          <section className={`${card} md:col-span-6`}>
            <h2 className={h2}>{x.myMeals}</h2>
            {self ? (<>
              <div className="mt-4"><HBars fmt={String} rows={plates.map(p => ({
                key: p.meal, text: t.meals.names[p.meal], value: p.plates - p.guests, tail: p.guests, valueText: String(p.plates),
                label: <>{t.meals.names[p.meal]}{p.guests > 0 && <span className="ml-1 text-[13px] text-muted">{x.guests.replace('{n}', String(p.guests))}</span>}</> }))} /></div>
              {mine && totalMeals > 0 && mo.result.mealRate > 0 && <p className="mt-4 text-[15px] text-muted">{x.mealsNote.replace('{n}', fmtMeals(mo.meals.get(me.memberId) ?? 0)).replace('{r}', fmtRate(mo.result.mealRate, totalMeals))}</p>}
            </>) : <p className="mt-2 text-muted">{t.money.notHere}</p>}
          </section>
          <section className={`${card} md:col-span-6`}>
            <h2 className={h2}>{x.lastMonths}</h2>
            {past.length < 2 ? <p className="mt-2 text-muted">{x.needTwo}</p> : (
              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <div><h3 className="font-semibold">{x.rate}</h3><div className="mt-2"><VBars fmt={v => fmtRate(v, 1)} cols={past.map(p => ({ key: p.month, label: short(p.month), value: p.rate }))} /></div></div>
                <div><h3 className="font-semibold">{x.spend}</h3><div className="mt-2"><VBars fmt={fmtTaka} cols={past.map(p => ({ key: p.month, label: short(p.month), value: p.spend }))} /></div></div>
              </div>)}
          </section>

          <section className={`${card} md:col-span-6`}>
            <h2 className={h2}>{x.myMonth}</h2>
            {mine && b ? (<>
              <div className="mt-4"><Stacked fmt={fmtTaka} rows={[
                [{ key: 'food', label: x.food, value: mine.foodCost, color: 'fill-turmeric', swatch: 'bg-turmeric' },
                 { key: 'bills', label: x.bills, value: mine.billShare, color: 'fill-muted', swatch: 'bg-muted' }],
                [{ key: 'paid', label: x.paidIn, value: mine.paidIn, color: 'fill-leaf', swatch: 'bg-leaf' }]]} /></div>
              {/* the receipt: each line is signed the way the result reads (+ adds to what you owe, or + adds to what you get
                  back when the month is in your favour), so the lines add up to the last one by hand */}
              <dl className="mt-4 divide-y divide-line text-[15px]">
                {([
                  [x.cost, mine.foodCost + mine.billShare],
                  ...(mine.payouts ? [[x.advances, mine.payouts]] : []),
                  [x.paidIn, -mine.paidIn],
                  ...(mine.opening ? [[x.earlier, -mine.opening]] : []),
                  ...(mine.adjustments ? [[x.corrections, -mine.adjustments]] : []),
                ] as [string, number][]).map(([k, v]): [string, number] => [k, mine.balance > 0 ? -v : v]).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-2"><dt>{k}</dt><dd className="whitespace-nowrap tabular-nums">{v > 0 ? '+' : ''}{fmtSigned(v)}</dd></div>
                ))}
                {/* the receipt follows the exact sign (40 poisha is still owed), while the strip tile keeps the whole-taka headline */}
                <div className={`flex justify-between gap-4 py-2 font-semibold ${mine.balance < 0 ? 'text-chili' : mine.balance > 0 ? 'text-leaf' : ''}`}><dt>{mine.balance < 0 ? x.tileOwe : mine.balance > 0 ? x.tileGet : x.tileEven}</dt><dd className="whitespace-nowrap tabular-nums">{fmtExact(mine.balance)}</dd></div>
              </dl>
              <Link href={`/${lang}/money${month !== thisMonth ? `?m=${month.slice(0, 7)}` : ''}`} className={`mt-2 inline-flex min-h-11 items-center ${link}`}>{t.money.breakdown}</Link>
            </>) : <p className="mt-2 text-muted">{t.money.notHere}</p>}
          </section>
          <section className={`${card} md:col-span-6`}>
            <h2 className={h2}>{x.mealsPer}</h2>
            <div className="mt-4"><HBars fmt={fmtMeals} rows={meals.map(p => ({
              key: p.id, text: name(p.id), value: p.meals, tail: p.guests, strong: p.id === me.memberId,
              label: <>{name(p.id)}{p.guests > 0 && <span className="ml-1 text-[13px] text-muted">{x.guests.replace('{n}', fmtMeals(p.guests))}</span>}</> }))} /></div>
          </section>

          {boss && (
            <section className={`${card} md:col-span-12`}>
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
