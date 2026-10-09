import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, mealDecision, MEALS, nowDhaka, type Meal } from '@/lib/meals';
import { loadHistory, loadMeals, upcomingAway, type HistoryRow } from '@/lib/meals-db';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../action-form';
import { awayAction, cancelAwayAction, guestAction, usualAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay, fmtTime, fmtWhen } from '../format';
import { Header } from '../header';
import { Nav } from '../nav';
import { checkChip, field, Field, Fold, focus, link, primary, PageSkeleton } from '../ui';
import { WeekChart } from '../week-chart';

export default function Meals({ params, searchParams }: PageProps<'/[lang]/meals'>) {
  return <Suspense fallback={<PageSkeleton />}><MealsBody params={params} searchParams={searchParams} /></Suspense>;
}

async function MealsBody({ params, searchParams }: Pick<PageProps<'/[lang]/meals'>, 'params' | 'searchParams'>) {
  const { lang } = await params;
  const mine = (await searchParams).mine === '1';
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), m = t.meals;
  const now = nowDhaka(), today = now.slice(0, 10);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [meals, history, aways] = await Promise.all([
    loadMeals(db, me.flatId, today, week[6]),
    loadHistory(db, me.flatId, mine ? me.memberId : null),
    upcomingAway(db, me.flatId, me.memberId, addDays(today, 1)),
  ]);
  const starter = meals.members.find(x => x.role === 'manager');
  const self = meals.members.find(x => x.id === me.memberId)!;
  const decide = (date: string) => mealDecision(date, now, meals.flat.cutoff);
  const firstOpen = week.find(d => decide(d) === 'open')!;   // tomorrow or the day after
  const card = 'mt-8 rounded-3xl border border-line bg-surface p-5';
  const range = (r: [string, string]) => (r[0] === r[1] ? fmtDay(r[0], lang) : `${fmtDay(r[0], lang)} – ${fmtDay(r[1], lang)}`);
  /** One history line, e.g. 'Nafis → Tahsin · Sat, 10 October · Lunch: Off · Late'. */
  const describe = (h: HistoryRow) => {
    const actor = h.actor ?? '?', who = h.who ?? '?', a = h.after;
    const mealList = (x: string) => x.split(',').map(y => m.names[y as Meal]).join(', ');
    if (h.entity === 'flats') return `${actor} ${m.rulesChanged}: ${fmtTime(a.cutoff ?? '22:00')} · ${MEALS.map(x => `${m.names[x]} ${(a.weights?.[x] ?? 0) / 100}`).join(', ')}`;
    if (h.entity === 'members') {
      if (a.inMeals === false) return `${who} ${m.ownStarted}`;
      if (a.inMeals === true) return `${who} ${m.ownStopped}`;
      return `${who} · ${m.usualChanged}: ${MEALS.filter(x => a[x]).map(x => m.names[x]).join(', ') || m.none}`;
    }
    if (a.nocook) return `${actor} · ${m.noCook} · ${range(a.nocook)} · ${mealList(a.meals!)}`;
    if (a.cookAgain) return `${actor} · ${m.noCookAgain} · ${range(a.cookAgain)} · ${mealList(a.meals!)}`;
    if (a.away) return `${who} · ${m.away} · ${range(a.away)}`;
    if (a.awayCancel) return `${who} · ${m.awayCancelled} · ${range(a.awayCancel)}`;
    const [, date, meal] = h.entityId.split('|');
    const value = a.count! > 1 ? `${a.count} ${m.platesShort}` : a.count ? m.on : m.off;
    const tag = a.late ? ` · ${m.late}` : '';
    return `${actor === who ? who : `${actor} → ${who}`} · ${fmtDay(date, lang)} · ${m.names[meal as Meal]}: ${value}${tag}`;
  };
  const h2 = 'text-xl font-bold';
  const todayNote = starter?.id === me.memberId ? m.todayLockedSelf : m.todayLocked.replace('{name}', starter?.name ?? '');

  return (
    <>
      <Header t={t} lang={lang} path="/meals"><Nav t={t} lang={lang} current="meals" showFlat={me.role === 'manager'} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        <h1 className="font-display text-3xl font-bold">{m.weekTitle}</h1>
        <p className="mt-2 text-muted">{m.weekLead}</p>
        <div className="mt-6">
          <WeekChart lang={lang} m={m} meId={me.memberId} week={week} decide={decide} note={todayNote} {...meals} />
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-2 md:items-start lg:grid-cols-3 [&>*]:mt-0">
          <Fold title={m.guestTitle} lead={m.guestLead}>
            <ActionForm action={guestAction} className="mt-4">
              <input type="hidden" name="lang" value={lang} />
              <label className="block font-semibold">
                {m.day}
                <select name="date" defaultValue={week[1]} className={field}>
                  {week.slice(1).map(d => <option key={d} value={d}>{fmtDay(d, lang)}</option>)}
                </select>
              </label>
              <label className="block font-semibold">
                {m.meal}
                <select name="meal" defaultValue="d" className={field}>
                  {MEALS.map(x => <option key={x} value={x}>{m.names[x]}</option>)}
                </select>
              </label>
              <Field label={m.guests} name="guests" type="number" inputMode="numeric" min={0} max={9} required defaultValue={1} />
              <label className={checkChip}>
                <input type="checkbox" name="me" defaultChecked={self.inMeals} className="size-5 shrink-0 accent-ink" />
                {m.meToo}
              </label>
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
              <Field label={m.from} name="from" type="date" required min={firstOpen} defaultValue={firstOpen} />
              <Field label={m.to} name="to" type="date" required min={firstOpen} defaultValue={firstOpen} />
              <button className={primary}>{m.awayBtn}</button>
            </ActionForm>
          </Fold>

          <Fold title={m.usualTitle} lead={self.inMeals ? m.usualLead : m.ownNow}>
            <ActionForm action={usualAction} className="mt-4">
              <input type="hidden" name="lang" value={lang} />
              <div className="grid grid-cols-3 gap-2">
                {MEALS.map(x => (
                  <label key={x} className={checkChip}>
                    <input type="checkbox" name={x} defaultChecked={self.defaults[x]} className="size-5 shrink-0 accent-ink" />
                    {m.names[x]}
                  </label>
                ))}
              </div>
              <p className="text-[15px] text-muted">{m.usualOff}</p>
              <button className={primary}>{m.save}</button>
            </ActionForm>
          </Fold>
        </div>

        <section className={card}>
          <h2 className={h2}>{m.historyTitle}</h2>
          <p className="mt-1 text-muted">{m.historyLead}</p>
          <div className="mt-3 flex gap-2">
            {[[false, m.everyoneTab], [true, m.mineOnly]].map(([on, label]) => (
              <Link key={String(on)} href={on ? `/${lang}/meals?mine=1` : `/${lang}/meals`} scroll={false} aria-current={mine === on ? 'true' : undefined}
                className={`inline-flex min-h-11 items-center rounded-full px-4 font-semibold ${mine === on ? 'bg-turmeric text-on-turmeric' : 'border border-muted'} ${focus}`}>
                {label}
              </Link>
            ))}
          </div>
          {history.length === 0 ? (
            <p className="mt-3 text-muted">{m.noHistory}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {history.map((h, i) => (
                <li key={i} className="py-3">
                  <p>{describe(h)}</p>
                  <p className="text-[15px] text-muted">{fmtWhen(h.at, lang)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
