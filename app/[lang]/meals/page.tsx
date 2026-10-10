import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, firstWeek, indexChanges, isDate, isPresent, mealCount, mealDecision, MEALS, nowDhaka, type Meal } from '@/lib/meals';
import { flatStart, loadHistory, loadMeals, myGuests, upcomingAway, type HistoryRow } from '@/lib/meals-db';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../action-form';
import { awayAction, cancelAwayAction, guestAction, otherMealAction, removeGuestsAction, usualAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { dhakaDate, fmtDay, fmtExact, fmtMonth, fmtRange, fmtTime, fmtWhen } from '../format';
import { Header } from '../header';
import { Nav } from '../nav';
import { checkChip, field, Field, Fold, focus, link, LongList, primary, secondary, PageSkeleton } from '../ui';
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
  const now = nowDhaka(), today = now.slice(0, 10);
  // which week to show: 0 = this week, up to 7 weeks ahead (changes are allowed up to 60 days out); back, read-only, so anyone
  // can check what they were counted for: 8 weeks (this month and last), never before the flat's first move-in
  const back = Math.max(-8, firstWeek(today, await flatStart(db, me.flatId)));
  const w = Math.min(7, Math.max(back, Math.trunc(Number(sp.week)) || 0));
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, 7 * w + i));
  const [meals, history, aways, guestList] = await Promise.all([
    loadMeals(db, me.flatId, week[0], week[6]),
    loadHistory(db, me.flatId, mine ? me.memberId : null, shownRows + 1),
    upcomingAway(db, me.flatId, me.memberId, addDays(today, 1)),
    myGuests(db, me.flatId, me.memberId, today),
  ]);
  const starter = meals.members.find(x => x.role === 'manager');
  const self = meals.members.find(x => x.id === me.memberId)!;
  const decide = (date: string) => mealDecision(date, now, meals.flat.cutoff);
  const firstOpen = [1, 2].map(n => addDays(today, n)).find(d => decide(d) === 'open')!;   // tomorrow or the day after
  // "Someone else's meals": the person and day come from ?who=&day=, like the collector's fold on the Flat tab
  const others = meals.members.filter(x => x.id !== me.memberId && x.inMeals && (!x.leftOn || x.leftOn >= firstOpen));
  const pickDay = isDate(sp.day) && sp.day >= firstOpen && sp.day <= addDays(today, 60) ? sp.day : firstOpen;
  const pick = others.find(x => x.id === sp.who) ?? others[0];
  const pickData = pick ? await loadMeals(db, me.flatId, pickDay, pickDay) : null;
  const pickAway = pick ? (await upcomingAway(db, me.flatId, pick.id, firstOpen)).some(([f, t]) => pickDay >= f && pickDay <= t) : false;
  const guestDays = week.filter(d => d === today || decide(d) !== 'closed');   // today too: a host may add surprise guests
  const href = (n: number, only: boolean, more = 0) => `/${lang}/meals?${new URLSearchParams({ ...(n ? { week: String(n) } : {}), ...(only ? { mine: '1' } : {}), ...(more ? { older: String(more) } : {}) })}`;
  const hasOlder = history.length > shownRows;
  const arrow = `inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full border border-muted px-3 font-semibold hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-40 sm:px-4 ${focus}`;
  const card = 'mt-8 rounded-3xl border border-line bg-surface p-5';
  const range = (r: [string, string]) => (r[0] === r[1] ? fmtDay(r[0], lang) : `${fmtDay(r[0], lang)} – ${fmtDay(r[1], lang)}`);
  /** One history line, e.g. 'Nafis → Tahsin · Sat, 10 October · Lunch: Off · Late'. */
  const describe = (h: HistoryRow) => {
    const actor = h.actor ?? '?', who = h.who ?? '?', a = h.after;
    const mealList = (x: string) => x.split(',').map(y => m.names[y as Meal]).join(', ');
    if (h.entity === 'cook') return `${actor} ${m.toldHistory} · ${fmtDay(a.told!, lang)}: ${MEALS.map(x => `${m.names[x]} ${a.plates?.[x] ?? 0}`).join(', ')}`;
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
    if (h.entity === 'flats') return `${actor} ${m.rulesChanged}: ${fmtTime(a.cutoff ?? '22:00')} · ${MEALS.map(x => `${m.names[x]} ${(a.weights?.[x] ?? 0) / 100}`).join(', ')}`;
    if (h.entity === 'members') {
      if (a.back) return `${actor} · ${who} · ${m.backHistory}: ${range(a.back)}`;
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
    const tag = !a.late ? '' : ` · ${dhakaDate(h.at) >= date ? m.lateSameDay : m.lateAfter.replace('{t}', fmtTime(meals.flat.cutoff))}`;
    return `${actor === who ? who : `${actor} → ${who}`} · ${fmtDay(date, lang)} · ${m.names[meal as Meal]}: ${value}${tag}`;
  };
  const h2 = 'text-xl font-bold';
  const todayNote = starter?.id === me.memberId ? m.todayLockedSelf : m.todayLocked.replace('{name}', starter?.name ?? '');

  return (
    <>
      <Header t={t} lang={lang} path="/meals"><Nav t={t} lang={lang} current="meals" showFlat={me.role === 'manager'} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        <h1 className="font-display text-3xl font-bold">{m.mealsTitle}</h1>
        <p className="mt-2 text-muted">{w < 0 ? m.pastLead : m.weekLead}</p>
        <nav aria-label={m.weekNav} className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {/* at either end the arrow stays in place, greyed out, so keyboard focus is not lost */}
          <Link href={href(Math.max(back, w - 1), mine)} scroll={false} aria-label={m.prevWeek} aria-disabled={w === back || undefined} className={`justify-self-start ${arrow}`}><span aria-hidden="true">←</span><span aria-hidden="true" className="hidden sm:inline">{m.prevWeek}</span></Link>
          <p className="text-center font-semibold">{fmtRange(week[0], week[6])}</p>
          <Link href={href(Math.min(7, w + 1), mine)} scroll={false} aria-label={m.nextWeek} aria-disabled={w === 7 || undefined} className={`justify-self-end ${arrow}`}><span aria-hidden="true" className="hidden sm:inline">{m.nextWeek}</span><span aria-hidden="true">→</span></Link>
        </nav>
        <div className="mt-4">
          <WeekChart lang={lang} m={m} meId={me.memberId} today={today} week={week} decide={decide} note={todayNote} {...meals} />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start lg:grid-cols-3 [&>*]:mt-0">
          <Fold title={m.guestTitle} lead={m.guestLead}>
            {guestList.length > 0 && (
              <div className="mt-4">
                <p className="font-semibold">{m.yourGuests}</p>
                <ul className="mt-2 divide-y divide-line">
                  {guestList.map(g => (
                    <li key={`${g.date}${g.meal}`} className="flex flex-wrap items-center justify-between gap-x-3 py-2">
                      <span>{fmtDay(g.date, lang)} · {m.names[g.meal]} · {g.guests === 1 ? m.guestOne : m.guestMany.replace('{n}', String(g.guests))}</span>
                      {/* removing today's guests stays with the person who runs the flat */}
                      {g.date === today ? <span className="text-[15px] text-muted">{m.todayGuestsKeep}</span> : (
                        <form action={removeGuestsAction}>
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="date" value={g.date} />
                          <input type="hidden" name="meal" value={g.meal} />
                          <button className={`min-h-11 px-2 font-semibold ${link}`}>{m.removeGuests}</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ActionForm action={guestAction} className="mt-4">
              <input type="hidden" name="lang" value={lang} />
              <DateField lang={lang} label={m.day} name="date" required min={today} max={addDays(today, 60)} defaultValue={guestDays[0]} />
              <label className="block font-semibold">
                {m.meal}
                <select name="meal" defaultValue="d" className={field}>
                  {MEALS.map(x => <option key={x} value={x}>{m.names[x]}</option>)}
                </select>
              </label>
              <Field label={m.guests} name="guests" type="number" inputMode="numeric" min={1} max={9} required defaultValue={1} hint={m.todayGuestHint} />
              <button className={primary}>{m.save}</button>
            </ActionForm>
          </Fold>

          <Fold title={m.awayTitle} lead={m.awayLead}>
            {aways.some(([, t]) => t >= firstOpen) && (
              <div className="mt-4">
                <p className="font-semibold">{m.awayList}</p>
                <ul className="mt-2 divide-y divide-line">
                  {aways.filter(([, t]) => t >= firstOpen).map(([f, t]) => (
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
              <DateField lang={lang} label={m.from} name="from" required min={firstOpen} max={addDays(today, 60)} defaultValue={firstOpen} />
              <DateField lang={lang} label={m.to} name="to" required min={firstOpen} max={addDays(today, 60)} defaultValue={firstOpen} />
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
              <form className="mt-4 space-y-4">
                {w !== 0 && <input type="hidden" name="week" value={w} />}
                <label className="block font-semibold">
                  {m.who}
                  <select name="who" defaultValue={pick.id} className={field}>
                    {others.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                <DateField lang={lang} label={m.day} name="day" required min={firstOpen} max={addDays(today, 60)} defaultValue={pickDay} />
                <button className={secondary}>{m.show}</button>
              </form>
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
