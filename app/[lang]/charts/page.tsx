import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { billNames, billShareIn, costRows, forecast, history, inAndOut, lastMonths, mealGrid, myPlates, runningSpend, slices, spendByKind, worthALook } from '@/lib/charts';
import { db } from '@/lib/db';
import { flatMoney } from '@/lib/handover';
import { addDays, daysOfMonth, todayDhaka, weightedMeals } from '@/lib/meals';
import { loadMonth, monthOf } from '@/lib/money-db';
import { noticeCount } from '@/lib/notices';
import { requireMember } from '@/lib/session';
import { Lollipops, MealGrid, Meter, MonthCards, SplitBars } from '../bars';
import { getDictionary, hasLocale, type Dict } from '../dictionaries';
import { fmtDay, fmtExact, fmtMeals, fmtMonth, fmtRate, fmtSigned, fmtTaka, names } from '../format';
import { Header, withQuery } from '../header';
import { balanceText } from '../money/bits';
import { Nav } from '../nav';
import { card, focus, link, PageSkeleton } from '../ui';
import { Ring } from './ring';
import { SpendLine } from './spend-line';

export default function Charts({ params, searchParams }: PageProps<'/[lang]/charts'>) {
  return <Suspense fallback={<PageSkeleton />}><Body params={params} searchParams={searchParams} /></Suspense>;
}

/** The first letter as a reader sees it (a Bangla letter with its marks), for the lollipop discs. */
const initial = (name: string) => ([...new Intl.Segmenter().segment(name.trim())][0]?.segment ?? '?').toUpperCase();
const short = (month: string) => new Date(`${month}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const h2 = 'font-display text-xl font-bold';

/** One number with its label and a line of context: the strip across the top. */
function Tile({ label, value, note, tone = '' }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-[28px] leading-tight font-bold tabular-nums [overflow-wrap:anywhere] ${tone}`}>{value}</p>
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
  const [mo, past, hist] = await Promise.all([loadMonth(db, me.flatId, month, today), lastMonths(db, me.flatId, month),
    boss && month === thisMonth ? history(db, me.flatId, month) : []]);
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
  const grid = self ? mealGrid(self, mo.changes, days.slice(0, upTo + 1)) : null;
  // what each meal's plates count as (breakfast is often half). A closed month's meals are frozen: if the flat's weights moved
  // since, the rows would not add up to the frozen total, so the counts-as lines stay out rather than show a sum that is off
  const weights = mo.flat.weights, myMeals = mo.meals.get(me.memberId) ?? 0;
  const weightsHold = plates.reduce((a, p) => a + p.plates * weights[p.meal], 0) === myMeals;
  const spent = runningSpend(mo.entries, days);
  // "Bills" says what it holds: the flat's bills on the cost card, and on My month only the ones charged to me (a closed month
  // keeps no per-bill shares, so there the word stands alone)
  const billsWith = (list: string[] | null) => (list?.length ? x.billsOf.replace('{list}', names(list.map(k => (k === x.others ? k.toLowerCase() : k)), t.money.and)) : x.bills);
  // My month's parts: came in in leaf (the carried part lighter), used in the colours food and bills have on the whole page
  const parts: Record<string, { label: string; color: string }> = {
    earlier: { label: x.earlier, color: 'bg-leaf/50' }, paid: { label: x.paidIn, color: 'bg-leaf' }, corrections: { label: x.corrections, color: 'bg-ink' },
    owed: { label: x.owedEarlier, color: 'bg-chili/50' }, food: { label: x.food, color: 'bg-turmeric' }, bills: { label: billsWith(billNames(mo.entries, mo.result.lines, me.memberId, x.others)), color: 'bg-muted' }, advances: { label: x.advances, color: 'bg-chili' } };
  const named = (ps: { key: string; value: number }[]) => ps.map(p => ({ ...p, ...parts[p.key] }));
  const costs = boss ? costRows(mo.result.perMember) : [];
  const avgCost = costs.length ? Math.round(costs.reduce((a, r) => a + r.food + r.bills, 0) / costs.length) : 0;
  // what the line says at each drawn day: the date, the spend by then and what that day added
  const tips = spent.slice(0, upTo + 1).map((p, k) => { const add = p.value - (k ? spent[k - 1].value : 0);
    return { date: fmtDay(p.day, lang), total: fmtTaka(p.value), add: add ? x.thatDay.replace('{t}', fmtTaka(add)) : null }; });
  const empty = !mo.entries.some(e => e.status === 'ok') && totalMeals === 0;
  const b = mine ? balanceText(t.money, mine.balance, closed) : null;
  // My month speaks in exact amounts, so its words and colour follow the exact sign (the tile above rounds to whole taka)
  const verdict = !mine ? '' : mine.balance < 0 ? x.tileOwe : mine.balance > 0 ? x.tileGet : x.tileEven;
  const vtone = !mine ? '' : mine.balance < 0 ? 'text-chili' : mine.balance > 0 ? 'text-leaf' : '';
  // money with the collector, as Money shows it (this month adds every open month up while an earlier one is still open)
  const held = running && mo.earlierOpen ? await flatMoney(db, me.flatId, today) : mo.result.fund;
  const holder = closed && mo.info?.cash ? name(mo.info.cash.by) : mo.all.find(p => p.role === 'manager')?.name ?? '';
  // the month before, for the deltas: only a closed month next to this one
  const before = past.at(-1)?.month === prev ? past.at(-1)! : null;
  const rateD = delta(x, mo.result.mealRate, before?.rate ?? null, before?.month ?? null, closed);
  const spendD = delta(x, total, before?.spend ?? null, before?.month ?? null, closed);
  const axis = [0, 1, 2, 3, 4].map(k => Math.round((k * (days.length - 1)) / 4));   // five labels where the drawn days really are
  // the month end at this pace: bazar so far stretched over the month, everyone's usual meals filling the days ahead, and my
  // bills no lower than last closed month's share (the cook's pay lands late). Only while the month runs, only for someone
  // living here this month (a leaver's carried balance is not a bill to come). Signs follow the whole taka shown, as on Money.
  const whole = running ? weightedMeals(mo.members, mo.changes, month, mo.flat.weights) : null;
  // a flat that started mid-month has had bazar only since its first person moved in: the pace counts from that day
  const start = Math.max(0, days.indexOf(mo.members.reduce((a, p) => (p.joinedOn < a ? p.joinedOn : a), days[upTo])));
  const ahead = whole ? forecast(spend[0].value, upTo + 1 - start, days.length - start, [...whole.values()].reduce((a, b) => a + b, 0), whole.get(me.memberId) ?? 0) : null;
  const you = ahead && self && mine ? mine : null;
  const lastBills = you && mo.carriedFrom ? await billShareIn(db, me.flatId, me.memberId, mo.carriedFrom) : null;
  const bills = you ? Math.max(you.billShare, lastBills ?? 0) : 0;
  const ending = ahead && you ? Math.round((you.opening + you.paidIn - ahead.food - bills - you.payouts + you.adjustments) / 100) : 0;
  // the collector's look-over of the running month: rules on the flat's own saved rows, each line a question with a link to Money
  const looks = boss && running ? worthALook(mo.entries, hist, today) : null;
  // the forecast card pairs each figure as it stands with where it ends, one small arrow between; the sign of a line is its colour
  const tone = (p: number) => (p < 0 ? 'text-chili' : p > 0 ? 'text-leaf' : '');
  const to = <svg aria-hidden="true" className="h-3 w-5 flex-none stroke-muted" fill="none" viewBox="0 0 20 12"><path d="M1 6h17m-4-4 4 4-4 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
  const pair = (label: string, now: string, end: string, endTone = '', nowTone = '') => (
    <li>
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-2 tabular-nums">
        <span className={`text-[15px] ${nowTone || 'text-muted'}`}>{now}</span>{to}
        <span className={`text-[28px] leading-tight font-bold ${endTone}`}>{end}</span>
      </p>
    </li>);

  return (
    <>
      <Header t={t} lang={lang} path={withQuery('/charts', sp)} notices={await noticesP}><Nav t={t} lang={lang} topic={me.liveTopic} current="charts" showFlat={boss} /></Header>
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
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className={h2}>{x.pace}</h2>
                <p className="text-[15px] text-muted tabular-nums">{x.paceDays.replace('{d}', String(upTo + 1)).replace('{n}', String(days.length))}</p>
              </div>
              {/* the month as a track: the days gone in turmeric, the rest paper, the way the spend line's ruled page runs */}
              <svg aria-hidden="true" className="mt-3 h-1.5 w-full" preserveAspectRatio="none" viewBox="0 0 100 2">
                <rect className="fill-line" height="2" rx="1" width="100" /><rect className="fill-turmeric" height="2" rx="1" width={((upTo + 1) / days.length) * 100} />
              </svg>
              {ahead ? (<>
                <p className="mt-4 flex items-center gap-2 text-[13px] text-muted"><span>{x.soFar}</span>{to}<span>{x.paceEnd}</span></p>
                <ul className="mt-3 grid gap-5 sm:grid-cols-3">
                  {pair(x.rate, fmtRate(mo.result.mealRate, totalMeals), fmtRate(ahead.rate, 1))}
                  {you && pair(x.cost, fmtTaka(you.foodCost + you.billShare), fmtTaka(ahead.food + bills))}
                  {you && b && pair(x.paceLine, `${b.tone === 'text-chili' ? '−' : ''}${fmtTaka(you.balance)}`, fmtSigned(ending * 100), tone(ending), b.tone)}
                </ul>
                <p className="mt-4 text-[13px] text-muted">{x.paceNote.replace('{d}', String(upTo + 1 - start)).replace('{b}', you && lastBills !== null && lastBills > you.billShare ? x.paceBillsLast : x.paceBillsSoFar)}</p>
              </>) : <p className="mt-4 text-muted">{x.paceWait}</p>}
            </section>)}
          {/* only when there is a question: a card that says nothing stands out is weight on every visit */}
          {looks && looks.length > 0 && (
            <section className={`${card} md:col-span-12`}>
              <h2 className={h2}>{x.look}</h2>
              <p className="mt-1 text-[15px] text-muted">{x.lookHint}</p>
              {/* each question drawn the way it is asked: how big against the biggest before, the twin rows, when it usually comes */}
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {looks.map((l, i) => (
                  <li key={i} className="flex flex-col rounded-2xl bg-paper p-4">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="rounded-full border border-line bg-surface px-2.5 text-[13px] font-semibold leading-6 whitespace-nowrap">{x.lookKinds[l.kind]}</span>
                      <span className="font-semibold">{l.kind === 'missing' ? l.note : fmtDay(l.date, lang)}</span>
                    </p>
                    {l.kind === 'high' && (<>
                      <div aria-hidden="true" className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 text-[13px]">
                        <span>{x.lookThis}</span><span className="h-2.5 rounded-full bg-chili" /><span className="font-semibold tabular-nums">{fmtExact(l.amount)}</span>
                        <span>{x.lookBefore}</span><span className="h-2.5 rounded-full bg-muted" style={{ width: `${(l.max / l.amount) * 100}%` }} /><span className="tabular-nums">{fmtExact(l.max)}</span>
                      </div>
                      <p className="mt-3 text-[15px]"><span className="sr-only">{x.lookThis} {fmtExact(l.amount)}. {x.lookBefore} {fmtExact(l.max)}. </span>
                        {x.lookMore.replace('{p}', String(Math.max(1, Math.round(((l.amount - l.max) / l.max) * 100))))}</p>
                    </>)}
                    {l.kind === 'dup' && (<>
                      <ul aria-hidden="true" className="mt-3 space-y-1.5 text-[13px]">
                        {Array.from({ length: l.n }, (_, k) => (
                          <li key={k} className="flex justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-1.5">
                            <span className="min-w-0 truncate">{l.note ?? t.money.types[l.type]}</span><span className="tabular-nums">{fmtExact(l.amount)}</span>
                          </li>))}
                      </ul>
                      <p className="mt-3 text-[15px]"><span className="sr-only">{l.note ?? t.money.types[l.type]} {fmtExact(l.amount)}. </span>{x.lookSame.replace('{n}', String(l.n))}</p>
                    </>)}
                    {l.kind === 'missing' && (<>
                      {/* the month as a track: the days gone in turmeric, a tick where it was usually in by */}
                      <div aria-hidden="true" className="relative mt-5 h-2 rounded-full bg-line">
                        <span className="absolute inset-y-0 left-0 rounded-full bg-turmeric" style={{ width: `${((upTo + 1) / days.length) * 100}%` }} />
                        <span className="absolute -top-1.5 h-5 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${(l.day / days.length) * 100}%` }} />
                      </div>
                      <p className="mt-3 text-[15px]">{x.lookUsual.replace('{d}', String(l.day)).replace('{t}', String(upTo + 1))}</p>
                    </>)}
                    <Link href={`/${lang}/money#entries`} className={`mt-auto inline-flex min-h-11 items-center self-start pt-2 ${link}`}>{x.lookOpen}<span className="sr-only">: {x.lookKinds[l.kind]}, {l.kind === 'missing' ? l.note : fmtDay(l.date, lang)}</span></Link>
                  </li>))}
              </ul>
            </section>)}
          <section className={`${card} md:col-span-12 lg:col-span-8 lg:flex lg:flex-col`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className={h2}>{x.through}</h2>
              <p className="text-[15px] text-muted">{x.throughNote.replace('{t}', fmtTaka(spent[upTo].value)).replace('{d}', fmtDay(days[upTo], lang))}</p>
            </div>
            <div className="mt-4 lg:flex lg:flex-1 lg:flex-col"><SpendLine values={spent.map(p => p.value)} upTo={upTo} running={running} label={x.through} tips={tips} /></div>
            <ol aria-hidden="true" className="mt-1 flex justify-between text-[13px] text-muted tabular-nums">
              {axis.map(i => <li key={i}>{i + 1}</li>)}
            </ol>
            {running && <p className="mt-2 text-[13px] text-muted">- - - {x.today}</p>}
          </section>
          <section className={`${card} md:col-span-12 lg:col-span-4`}>
            <h2 className={h2}>{x.whereWent}</h2>
            <div className="mt-4"><Ring total={fmtTaka(total)} slices={slices(spend, x.others).map(r => ({ ...r, text: fmtTaka(r.value) }))} /></div>
          </section>

          <section className={`${card} md:col-span-6`}>
            {/* the card adds itself up: plates per meal, what they count as, the meals, then the food they cost */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 className={h2}>{x.myMeals}</h2>
              {self && <p className="text-[15px] font-semibold tabular-nums">{(Math.round(myMeals) === 100 ? x.mealOne : x.mealsTotal).replace('{n}', fmtMeals(myMeals))}</p>}
            </div>
            {self ? (<>
              <div className="mt-4"><MealGrid n={days.length} legend={[x.gridAte, x.gridGuest, x.gridSkipped, x.gridGuestOnly]} rows={plates.map(p => ({
                key: p.meal, label: t.meals.names[p.meal], cells: grid![p.meal], total: (p.plates === 1 ? x.plateOne : x.platesN).replace('{n}', String(p.plates)),
                note: [p.guests > 0 ? x.forGuests.replace('{g}', String(p.guests)) : '',
                  weightsHold && weights[p.meal] !== 100 ? x.countsAs.replace('{m}', fmtMeals(p.plates * weights[p.meal])) : ''].filter(Boolean).join(' · ') }))} /></div>
              {mine && totalMeals > 0 && mo.result.mealRate > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="flex justify-between gap-3 font-semibold"><span>{x.food}</span><span className="tabular-nums">{fmtExact(mine.foodCost)}</span></p>
                  <p className="text-[13px] text-muted">{x.mealsNote.replace('{n}', fmtMeals(myMeals)).replace('{r}', fmtRate(mo.result.mealRate, totalMeals))}</p>
                </div>)}
            </>) : <p className="mt-2 text-muted">{t.money.notHere}</p>}
          </section>
          <section className={`${card} md:col-span-6`}>
            <h2 className={h2}>{x.lastMonths}</h2>
            {past.length === 0 ? <p className="mt-2 text-muted">{x.needTwo}</p> : (
              // each number says how it moved from the month before, the way the tiles up top do
              <div className="mt-4"><MonthCards words={{ rate: x.rate, spend: x.spend, latest: running ? x.latest : null }} rows={past.map((p, i) => {
                const before = past[i - 1] ?? null, rd = delta(x, p.rate, before?.rate ?? null, before?.month ?? null, true), sd = delta(x, p.spend, before?.spend ?? null, before?.month ?? null, true);
                return { key: p.month, label: short(p.month), long: fmtMonth(p.month), href: href(p.month), rate: p.rate, rateText: fmtRate(p.rate, 1), spend: p.spend, spendText: fmtTaka(p.spend),
                  rateNote: rd.note ? { text: rd.note, tone: rd.tone } : undefined, spendNote: sd.note ? { text: sd.note, tone: sd.tone } : undefined,
                  aria: [x.openMonth.replace('{month}', fmtMonth(p.month)).replace('{s}', fmtTaka(p.spend)).replace('{r}', fmtRate(p.rate, 1)), rd.note && `${x.rate} ${rd.note}`, sd.note && `${x.spend} ${sd.note}`].filter(Boolean).join('. ') };
              })} /></div>)}
          </section>

          <section className={`${card} md:col-span-6`}>
            <h2 className={h2}>{x.myMonth}</h2>
            {mine ? (<>
              {/* the answer first, then why: how much of what came in was used, then the receipt that adds up to the answer */}
              <p className={`mt-3 flex flex-wrap items-baseline justify-between gap-x-4 font-semibold ${vtone}`}>
                <span>{verdict}</span><span className="text-[28px] leading-tight font-bold tabular-nums">{fmtExact(mine.balance)}</span>
              </p>
              <div className="mt-4"><Meter fmt={fmtExact} came={named(inAndOut(mine).came)} used={named(inAndOut(mine).used)}
                words={{ usedOf: x.usedOf, usedOnly: x.usedOnly, usedOver: x.usedOver, left: x.left, short: x.short, cameIn: x.cameIn }}
                total={{ label: verdict, text: fmtExact(mine.balance), tone: vtone }} /></div>
              <Link href={`/${lang}/money${month !== thisMonth ? `?m=${month.slice(0, 7)}` : ''}`} className={`mt-2 inline-flex min-h-11 items-center ${link}`}>{t.money.breakdown}</Link>
            </>) : <p className="mt-2 text-muted">{t.money.notHere}</p>}
          </section>
          <section className={`${card} md:col-span-6`}>
            <h2 className={h2}>{x.mealsPer}</h2>
            <div className="mt-4"><Lollipops rows={meals.map(p => ({
              key: p.id, text: name(p.id), initial: initial(name(p.id)), value: p.meals - p.guests, tail: p.guests, valueText: fmtMeals(p.meals), strong: p.id === me.memberId,
              label: <>{name(p.id)}{p.guests > 0 && <span className="ml-1 text-[13px] text-muted">{x.guests.replace('{n}', fmtMeals(p.guests))}</span>}</> }))} /></div>
          </section>

          {boss && (
            <section className={`${card} md:col-span-12`}>
              <h2 className={h2}>{x.costPer}</h2>
              <p className="mt-1 text-[15px] text-muted">{x.costHint}</p>
              <div className="mt-4"><SplitBars fmt={fmtTaka} mark={avgCost} words={[x.food, x.bills]} rows={costs.map(r => ({
                key: r.id, text: name(r.id), food: r.food, bills: r.bills, total: fmtTaka(r.food + r.bills), strong: r.id === me.memberId,
                sr: `${x.food} ${fmtTaka(r.food)}, ${x.bills} ${fmtTaka(r.bills)}`,
                label: <Link className={`block truncate leading-8 underline-offset-4 hover:underline ${focus}`} href={`/${lang}/money?${new URLSearchParams({ ...(month !== thisMonth ? { m: month.slice(0, 7) } : {}), who: r.id })}`}>{name(r.id)}</Link> }))} /></div>
              <p className="mt-3 text-[13px] text-muted"><span aria-hidden="true" className="mr-1 inline-block size-3 rounded-sm bg-turmeric" />{x.food} <span aria-hidden="true" className="mr-1 ml-3 inline-block size-3 rounded-sm bg-muted" />{billsWith(billNames(mo.entries, null, null, x.others))}<span aria-hidden="true" className="mr-1.5 ml-3 inline-block h-3 border-l-2 border-dashed border-ink align-middle" />{x.average.replace('{t}', fmtTaka(avgCost))}</p>
            </section>)}
        </div>
      </main>
    </>
  );
}
