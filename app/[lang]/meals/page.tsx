import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, daysOfMonth, firstWeek, headcount, indexChanges, isDate, isPresent, mealCount, mealDecision, MEALS, nowDhaka, ownPlate, type Meal } from '@/lib/meals';
import { flatStart, loadHistory, loadMeals, myGuests, upcomingAway, type HistoryRow } from '@/lib/meals-db';
import { requireMember } from '@/lib/session';
import { noticeCount } from '@/lib/notices';
import { ActionForm } from '../action-form';
import { awayAction, cancelAwayAction, guestAction, otherMealAction, removeGuestsAction, usualAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { dhakaDate, fmtDay, fmtExact, fmtMonth, fmtRange, fmtWhen } from '../format';
import { Header, withQuery } from '../header';
import { Nav } from '../nav';
import { ShowForm } from '../show-form';
import { card as baseCard, checkChip, field, Field, Fold, focus, link, LongList, primary, secondary, PageSkeleton } from '../ui';
import { DateField } from '../date-field';
import { WeekChart } from '../week-chart';

export default function Meals({ params, searchParams }: PageProps<'/[lang]/meals'>) {
  return <Suspense fallback={<PageSkeleton />}><MealsBody params={params} searchParams={searchParams} /></Suspense>;
}

async function MealsBody({ params, searchParams }: Pick<PageProps<'/[lang]/meals'>, 'params' | 'searchParams'>) {
  const { lang } = await params;
  const sp = await searchParams;
  const mine = sp.mine === '1';
  // older history comes 50 at a time (?older=1, 2 …); a longer slice of the same newest-first list, so nothing repeats or goes missing
  const older = Math.min(40, Math.max(0, Math.trunc(Number(sp.older)) || 0)), shownRows = 50 * (older + 1);
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), m = t.meals;
  const noticesP = noticeCount(db, me.flatId, me.memberId, me.role === 'manager');   // the bell's count, read alongside the page
  const now = nowDhaka(), today = now.slice(0, 10);
  // which week to show: 0 = this week, up to 7 weeks ahead (changes are allowed up to 60 days out); back, read-only, so anyone
  // can check what they were counted for: 8 weeks (this month and last), never before the flat's first move-in
  const back = Math.max(-8, firstWeek(today, await flatStart(db, me.flatId)));
  const w = Math.min(7, Math.max(back, Math.trunc(Number(sp.week)) || 0));
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, 7 * w + i));
  // the month grid shows the month the week starts in, read whole alongside the week
  const gridDays = daysOfMonth(`${week[0].slice(0, 7)}-01`);
  const [meals, history, aways, guestList, gridData] = await Promise.all([
    loadMeals(db, me.flatId, week[0], week[6]),
    loadHistory(db, me.flatId, mine ? me.memberId : null, shownRows + 1),
    upcomingAway(db, me.flatId, me.memberId, addDays(today, 1)),
    myGuests(db, me.flatId, me.memberId, today),
    loadMeals(db, me.flatId, gridDays[0], gridDays.at(-1)!),
  ]);
  const self = meals.members.find(x => x.id === me.memberId)!;
  const decide = (date: string) => mealDecision(date, today);
  const tomorrow = addDays(today, 1);
  // "Someone else's meals": the person and day come from ?who=&day=, like the collector's fold on the Flat tab
  const others = meals.members.filter(x => x.id !== me.memberId && x.inMeals && (!x.leftOn || x.leftOn >= today));
  const pickDay = isDate(sp.day) && sp.day >= today && sp.day <= addDays(today, 60) ? sp.day : today;
  const pick = others.find(x => x.id === sp.who) ?? others[0];
  const [pickData, pickAwayList] = await Promise.all([pick ? loadMeals(db, me.flatId, pickDay, pickDay) : null, pick ? upcomingAway(db, me.flatId, pick.id, today) : []]);
  const pickAway = pickAwayList.some(([f, t]) => pickDay >= f && pickDay <= t);
  const guestDays = week.filter(d => decide(d) !== 'closed');
  const href = (n: number, only: boolean, more = 0) => `/${lang}/meals?${new URLSearchParams({ ...(n ? { week: String(n) } : {}), ...(only ? { mine: '1' } : {}), ...(more ? { older: String(more) } : {}) })}`;
  const hasOlder = history.length > shownRows;
  const arrow = `inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full border border-muted px-3 font-semibold hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 sm:px-4 ${focus}`;
  const card = `mt-8 ${baseCard}`;
  const range = (r: [string, string]) => (r[0] === r[1] ? fmtDay(r[0], lang) : `${fmtDay(r[0], lang)} – ${fmtDay(r[1], lang)}`);
  /** One history line, e.g. 'Nafis → Tahsin · Sat, 10 October · Lunch: Off · Late'. */
  const describe = (h: HistoryRow) => {
    const actor = h.actor ?? '?', who = h.who ?? '?', a = h.after;
    const mealList = (x: string) => x.split(',').map(y => m.names[y as Meal]).join(', ');
    // rooms and rent: old → new, the old value saved from the database at the change. A rent row with no old value is a new room
    // (rent changes before this was saved exist only in test flats)
    if (h.entity === 'rooms') {
      const b = h.before, fixed = a.fixFor?.length ? ` · ${m.fixHistory.replace('{month}', a.fixFor.map(fmtMonth).join(', '))}` : '';
      if ('roomId' in a) {
        const room = (id: string | null | undefined, name: string | null | undefined) => (id ? name ?? '?' : m.noRoomHistory);
        return `${actor} · ${who} · ${m.roomHistory}: ${b && 'roomId' in b ? `${room(b.roomId, b.room)} → ` : ''}${room(a.roomId, a.room)}${fixed}`;
      }
      if (b?.rent_share_poisha == null) return `${actor} · ${m.roomAddedHistory}: ${a.name} · ${m.rentHistory} ${fmtExact(a.rent_share_poisha ?? 0)}${fixed}`;
      return `${actor} · ${a.name} · ${m.rentHistory}: ${fmtExact(b.rent_share_poisha)} → ${fmtExact(a.rent_share_poisha ?? 0)}${fixed}`;
    }
    if (h.entity === 'bill_templates') {
      const x = a.removed ? h.before : a;
      return `${actor} · ${a.removed ? m.repeatStopped : m.repeatStarted}: ${x?.name ?? '?'} · ${fmtExact(x?.amount_poisha ?? 0)}`;
    }
    if (h.entity === 'flats' && a.codeChanged) return `${actor} ${m.codeChangedHistory}`;
    if (h.entity === 'flats') return `${actor} ${m.rulesChanged}: ${MEALS.map(x => `${m.names[x]} ${(a.weights?.[x] ?? 0) / 100}`).join(', ')}`;
    if (h.entity === 'members') {
      if (a.pinReset) return a.admin ? `${who} · ${m.pinResetTeam}` : `${actor} · ${who} · ${m.pinResetHistory}`;
      if (a.locked) return `${who} · ${m.lockedHistory}`;
      if (a.lockCleared) return `${actor} · ${who} · ${m.lockClearedHistory}`;
      if (a.back) return `${actor} · ${who} · ${m.backHistory}: ${range(a.back)}`;
      if (a.added) return `${actor} · ${who} · ${m.addedHistory}: ${fmtDay(a.added, lang)}`;
      if ('left' in a) return `${actor} · ${who} · ${a.left ? `${m.lastDayHistory}: ${fmtDay(a.left, lang)}` : m.stayingHistory}`;
      if (a.rename) return `${actor} ${m.renamedHistory}: ${a.rename[0]} → ${a.rename[1]}`;
      if (a.inMeals === false) return `${who} ${m.ownStarted}`;
      if (a.inMeals === true) return `${who} ${m.ownStopped}`;
      return `${who} · ${m.usualChanged}: ${MEALS.filter(x => a[x]).map(x => m.names[x]).join(', ') || m.none}`;
    }
    if (a.nocook) return `${actor} · ${m.noCook} · ${range(a.nocook)} · ${mealList(a.meals!)}`;
    if (a.cookAgain) return `${actor} · ${m.noCookAgain} · ${range(a.cookAgain)} · ${mealList(a.meals!)}`;
    if (a.away) return `${who} · ${m.away} · ${range(a.away)}`;
    if (a.awayCancel) return `${who} · ${m.awayCancelled} · ${range(a.awayCancel)}`;
    const [, date, meal] = h.entityId.split('|');
    // a guest change says so outright, so removing a guest never reads like switching a meal off
    // rows saved before guests had their own column: plates above one were guests, as in migration 004
    const g = a.guests ?? Math.max(a.count! - 1, 0), was = h.before?.guests ?? Math.max((h.before?.count ?? 0) - 1, 0);
    const value = g !== was ? m.guestsChange.replace('{a}', String(was)).replace('{b}', String(g)) : a.count! - g ? m.onOther : m.offOther;
    const tag = a.late && dhakaDate(h.at) === date ? ` · ${m.lateSameDay}` : '';
    return `${actor === who ? who : `${actor} → ${who}`} · ${fmtDay(date, lang)} · ${m.names[meal as Meal]}: ${value}${tag}`;
  };
  const h2 = 'text-xl font-bold';

  return (
    <>
      <Header t={t} lang={lang} path={withQuery('/meals', sp)} notices={await noticesP}><Nav t={t} lang={lang} topic={me.liveTopic} current="meals" showFlat={me.role === 'manager'} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        {sp.why === 'notSaved' && <p role="status" className="mb-4 font-semibold text-chili">{t.app.notSavedNote}</p>}
        <h1 className="font-display text-3xl font-bold">{m.mealsTitle}</h1>
        <p className="mt-2 max-w-prose text-muted">{w < 0 ? m.pastLead : m.weekLead
          .replace('{b}', String(meals.flat.weights.b / 100)).replace('{l}', String(meals.flat.weights.l / 100)).replace('{d}', String(meals.flat.weights.d / 100))}</p>
        <nav aria-label={m.weekNav} className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {/* at either end the arrow stays in place, greyed out, so keyboard focus is not lost */}
          <Link href={href(Math.max(back, w - 1), mine)} scroll={false} aria-label={m.prevWeek} aria-disabled={w === back || undefined} className={`justify-self-start ${arrow}`}><span aria-hidden="true">←</span><span aria-hidden="true" className="hidden sm:inline">{m.prevWeek}</span></Link>
          <p className="text-center font-semibold">{fmtRange(week[0], week[6])}</p>
          <Link href={href(Math.min(7, w + 1), mine)} scroll={false} aria-label={m.nextWeek} aria-disabled={w === 7 || undefined} className={`justify-self-end ${arrow}`}><span aria-hidden="true" className="hidden sm:inline">{m.nextWeek}</span><span aria-hidden="true">→</span></Link>
        </nav>
        <div className="mt-4">
          <WeekChart lang={lang} m={m} meId={me.memberId} today={today} week={week} decide={decide} {...meals} />
        </div>

        {/* the month as a calendar: my three meals a day as dots, the flat's plates in the corner, each day a link to its week */}
        <section className={card}>
          <h2 className={h2}>{fmtMonth(gridDays[0])}</h2>
          <p className="mt-1 max-w-prose text-[15px] text-muted">{m.monthLead}</p>
          {(() => {
            const gridSelf = gridData.members.find(x => x.id === me.memberId);
            const weekOf = (d: string) => Math.floor((Date.parse(d) - Date.parse(today)) / 864e5 / 7);   // the ?week= that holds this day: week 0 starts today
            const lead = (new Date(`${gridDays[0]}T00:00:00Z`).getUTCDay() + 1) % 7;                     // blanks before the 1st, Saturday first
            return (
              <ol className="mt-4 grid grid-cols-7 gap-1 text-center text-[13px] sm:gap-2">
                {m.monthDays.map(d => <li key={d} aria-hidden="true" className="font-semibold text-muted">{d}</li>)}
                {Array.from({ length: lead }, (_, i) => <li key={`lead${i}`} aria-hidden="true" />)}
                {gridDays.map(d => {
                  const here = gridSelf ? isPresent(gridSelf, d) : false, n = weekOf(d), linkable = n >= back && n <= 7;
                  const dots = MEALS.map(x => (gridSelf ? ownPlate(gridSelf, gridData.changes, d, x) : 0) > 0);
                  const guests = gridData.changes.filter(c => c.memberId === me.memberId && c.date === d).reduce((a, c) => a + c.guests, 0);
                  const hc = headcount(gridData.members, gridData.changes, d), plates = hc.b + hc.l + hc.d;
                  const label = m.cellLabel.replace('{d}', fmtDay(d, lang)).replace('{meals}', here ? MEALS.map((x, i) => `${m.names[x]} ${dots[i] ? m.on : m.off}`).join(', ') : m.notInFlatSelf).replace('{plates}', (plates === 1 ? t.charts.plateOne : t.charts.platesN).replace('{n}', String(plates)));
                  const inner = (<>
                    <span className={`block font-semibold ${d === today ? 'text-turmeric-ink' : ''}`}>{Number(d.slice(8))}</span>
                    <span aria-hidden="true" className="mt-1 flex justify-center gap-1">
                      {dots.map((on, i) => <span key={i} className={`size-2 rounded-full ${!here ? 'opacity-0' : on ? 'bg-turmeric' : 'border border-muted'}`} />)}
                    </span>
                    <span aria-hidden="true" className="mt-0.5 block text-[11px] leading-4 text-muted tabular-nums">{guests > 0 ? `+${guests} · ` : ''}{plates}</span>
                  </>);
                  const box = `block rounded-xl border py-1.5 ${d === today ? 'border-turmeric' : 'border-line'} ${here ? '' : 'opacity-50'}`;
                  return (
                    <li key={d}>
                      {linkable ? <Link href={href(n, mine)} aria-label={label} className={`${box} hover:bg-paper ${focus}`}>{inner}</Link>
                        : <span role="img" aria-label={label} className={box}>{inner}</span>}
                    </li>);
                })}
              </ol>);
          })()}
        </section>

        <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start lg:grid-cols-3 [&>*]:mt-0">
          <Fold title={m.guestTitle} lead={m.guestLead}>
            {guestList.length > 0 && (
              <div className="mt-4">
                <p className="font-semibold">{m.yourGuests}</p>
                <ul className="mt-2 divide-y divide-line">
                  {guestList.map(g => (
                    <li key={`${g.date}${g.meal}`} className="flex flex-wrap items-center justify-between gap-x-3 py-2">
                      <span>{fmtDay(g.date, lang)} · {m.names[g.meal]} · {g.guests === 1 ? m.guestOne : m.guestMany.replace('{n}', String(g.guests))}</span>
                      <form action={removeGuestsAction}>
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="date" value={g.date} />
                        <input type="hidden" name="meal" value={g.meal} />
                        <button className={`min-h-11 px-2 font-semibold ${link}`}>{m.removeGuests}</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ActionForm action={guestAction} className="mt-4" clearOnDone>
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="key" value={randomUUID()} />
              <DateField lang={lang} label={m.day} name="date" required min={today} max={addDays(today, 60)} defaultValue={guestDays[0]} />
              <label className="block font-semibold">
                {m.meal}
                <select name="meal" defaultValue="d" className={field}>
                  {MEALS.map(x => <option key={x} value={x}>{m.names[x]}</option>)}
                </select>
              </label>
              <Field label={m.guests} name="guests" type="number" inputMode="numeric" min={1} max={9} required hint={m.todayGuestHint} />
              <button className={primary}>{m.save}</button>
            </ActionForm>
          </Fold>

          <Fold title={m.awayTitle} lead={m.awayLead}>
            {aways.length > 0 && (
              <div className="mt-4">
                <p className="font-semibold">{m.awayList}</p>
                <ul className="mt-2 divide-y divide-line">
                  {aways.map(([f, t]) => (
                    <li key={`${f}${t}`} className="flex items-center justify-between gap-3 py-2">
                      <span>{range([f, t])}</span>
                      <ActionForm action={cancelAwayAction}>
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="from" value={f} />
                        <input type="hidden" name="to" value={t} />
                        <button className={`min-h-11 px-4 font-semibold ${link}`}>{m.cancel}</button>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ActionForm action={awayAction} className="mt-4">
              <input type="hidden" name="lang" value={lang} />
              <DateField lang={lang} label={m.from} name="from" required min={today} max={addDays(today, 60)} defaultValue={tomorrow} />
              <DateField lang={lang} label={m.to} name="to" required min={today} max={addDays(today, 60)} defaultValue={tomorrow} />
              <button className={primary}>{m.awayBtn}</button>
            </ActionForm>
          </Fold>

          <Fold title={m.usualTitle} lead={self.inMeals ? m.usualLead : m.ownNow}>
            <ActionForm action={usualAction} className="mt-4">
              <input type="hidden" name="lang" value={lang} />
              <div className="grid grid-cols-3 gap-2">
                {MEALS.map(x => (
                  <label key={x} className={checkChip}>
                    <input type="checkbox" name={x} defaultChecked={self.defaults[x]} className="size-5 shrink-0 accent-on-turmeric" />
                    {m.names[x]}
                  </label>
                ))}
              </div>
              <p className="text-[15px] text-muted">{m.usualOff}</p>
              <button className={primary}>{m.save}</button>
            </ActionForm>
          </Fold>

          <Fold title={m.otherTitle} lead={m.otherLead} open={'who' in sp}>
            {!pick || !pickData ? <p className="mt-4 text-muted">{m.otherNone}</p> : (<>
              <ShowForm className="mt-4 space-y-4" hint={m.pressShow} panel={<>
              <p className="mt-5 font-semibold">{pick.name} · {fmtDay(pickDay, lang)}</p>
              {(() => {
                const person = pickData.members.find(x => x.id === pick.id);
                if (!person || !isPresent(person, pickDay)) return <p className="mt-2 text-muted">{m.notInFlat}</p>;
                if (pickAway) return <p className="mt-2 text-muted">{pick.name} · {m.away}</p>;
                const idx = indexChanges(pickData.changes);
                return (
                  <ul className="mt-2 divide-y divide-line">
                    {MEALS.map(meal => {
                      const g = pickData.changes.find(c => c.memberId === pick.id && c.date === pickDay && c.meal === meal)?.guests ?? 0;
                      const own = mealCount(person, idx, pickDay, meal) - g > 0 ? 1 : 0;
                      const blocked = pickData.noCook.some(n => n.date === pickDay && n.meal === meal);
                      return (
                        <li key={meal} className="py-3">
                          {blocked ? <p><span className="font-semibold">{m.names[meal]}</span> · {m.noCook}</p> : (
                            <ActionForm action={otherMealAction}>
                              <input type="hidden" name="lang" value={lang} />
                              <input type="hidden" name="target" value={pick.id} />
                              <input type="hidden" name="date" value={pickDay} />
                              <input type="hidden" name="meal" value={meal} />
                              <input type="hidden" name="own" value={own ? 0 : 1} />
                              <input type="hidden" name="seen" value={own} />
                              {/* ActionForm wraps its children in a fieldset, so the row's layout lives in this div */}
                              <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="font-semibold">{m.names[meal]}</span>
                              <button aria-pressed={own > 0} aria-label={`${own ? m.onOther : m.offOther}: ${pick.name}, ${m.names[meal]}`}
                                className={`min-h-11 rounded-full px-4 font-semibold ${own ? 'bg-turmeric text-on-turmeric' : 'border border-muted'} ${focus}`}>
                                {own ? m.onOther : m.offOther}
                              </button>
                              </div>
                            </ActionForm>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
              </>}>
                {w !== 0 && <input type="hidden" name="week" value={w} />}
                <label className="block font-semibold">
                  {m.who}
                  <select name="who" defaultValue={pick.id} className={field}>
                    {others.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                <DateField lang={lang} label={m.day} name="day" required min={today} max={addDays(today, 60)} defaultValue={pickDay} />
                <button className={secondary}>{m.show}</button>
              </ShowForm>
            </>)}
          </Fold>
        </div>

        <section className={card}>
          <h2 className={h2}>{m.historyTitle}</h2>
          <p className="mt-1 text-muted">{m.historyLead}</p>
          <div className="mt-3 flex gap-2">
            {[[false, m.everyoneTab], [true, m.mineOnly]].map(([on, label]) => (
              <Link key={String(on)} href={href(w, on === true)} scroll={false} aria-current={mine === on ? 'true' : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 font-semibold ${mine === on ? 'bg-turmeric text-on-turmeric' : 'border border-muted'} ${focus}`}>
                {label}
              </Link>
            ))}
          </div>
          {history.length === 0 ? (
            <p className="mt-3 text-muted">{m.noHistory}</p>
          ) : (<>
            <LongList label={m.historyTitle} keep={10} more={t.app.showAll.replace('{n}', String(Math.min(history.length, shownRows)))} less={t.app.showLess} items={history.slice(0, shownRows).map((h, i) => (
              <li key={i} className="py-3">
                <p>{describe(h)}</p>
                <p className="text-[15px] text-muted">{fmtWhen(h.at, lang)}</p>
              </li>
            ))} />
            {hasOlder && <Link href={href(w, mine, older + 1)} scroll={false} className={`mt-2 inline-flex min-h-11 items-center ${link}`}>{m.olderHistory}</Link>}
          </>)}
        </section>
      </main>
    </>
  );
}
