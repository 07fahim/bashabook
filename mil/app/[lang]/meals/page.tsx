import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, mealDecision, MEALS, nowDhaka, type Meal } from '@/lib/meals';
import { loadHistory, loadMeals, type HistoryRow } from '@/lib/meals-db';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../action-form';
import { awayAction, guestAction, inMealsAction, usualAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay, fmtWhen } from '../format';
import { Header } from '../header';
import { MealRow } from '../meal-row';
import { Nav } from '../nav';
import { checkChip, field, Field, primary, secondary } from '../ui';

export default function Meals({ params }: PageProps<'/[lang]/meals'>) {
  return <Suspense><MealsBody params={params} /></Suspense>;
}

async function MealsBody({ params }: Pick<PageProps<'/[lang]/meals'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), m = t.meals;
  const now = nowDhaka(), today = now.slice(0, 10);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [meals, history] = await Promise.all([loadMeals(db, me.flatId, today, week[6]), loadHistory(db, me.flatId)]);
  const starter = meals.members.find(x => x.role === 'manager');
  const self = meals.members.find(x => x.id === me.memberId)!;
  const decide = (date: string) => mealDecision(date, now, meals.flat.cutoff, meals.flat.strictness);
  const firstOpen = week.find(d => decide(d) === 'open')!;   // tomorrow or the day after
  const card = 'mt-8 rounded-2xl border border-line bg-surface p-5';
  const range = (r: [string, string]) => (r[0] === r[1] ? fmtDay(r[0], lang) : `${fmtDay(r[0], lang)} – ${fmtDay(r[1], lang)}`);
  /** One history line, e.g. 'Nafis → Tahsin · Sat, 10 October · Lunch: Off · Late'. */
  const describe = (h: HistoryRow) => {
    const actor = h.actor ?? '?', who = h.who ?? '?';
    if (h.after.nocook) return `${actor} · ${m.noCook} · ${range(h.after.nocook)} · ${h.after.meals!.split(',').map(x => m.names[x as Meal]).join(', ')}`;
    if (h.after.away) return `${who} · ${m.away} · ${range(h.after.away)}`;
    const [, date, meal] = h.entityId.split('|');
    const value = h.after.count! > 1 ? `${h.after.count} ${m.platesShort}` : h.after.count ? m.on : m.off;
    return `${actor === who ? who : `${actor} → ${who}`} · ${fmtDay(date, lang)} · ${m.names[meal as Meal]}: ${value}${h.after.late ? ` · ${m.late}` : ''}`;
  };
  const h2 = 'text-xl font-bold';

  return (
    <>
      <Header t={t} lang={lang} path="/meals" />
      <main className="mx-auto max-w-md px-5 pb-28">
        <h1 className="font-display text-3xl font-bold">{m.weekTitle}</h1>
        <p className="mt-2 text-muted">{m.weekLead}</p>
        <ul className="mt-6 space-y-6">
          {week.map((date, i) => (
            <li key={date}>
              <p className="font-semibold">
                {i === 0 ? `${m.today} · ` : i === 1 ? `${m.tomorrow} · ` : ''}{fmtDay(date, lang)}
              </p>
              <MealRow lang={lang} m={m} meId={me.memberId} date={date} decision={decide(date)} {...meals} />
              {i === 0 && (
                <p className="mt-2 text-[15px] text-muted">
                  {starter?.id === me.memberId ? m.todayLockedSelf : m.todayLocked.replace('{name}', starter?.name ?? '')}
                </p>
              )}
            </li>
          ))}
        </ul>

        <section className={card}>
          <h2 className={h2}>{m.guestTitle}</h2>
          <p className="mt-1 text-muted">{m.guestLead}</p>
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
            <Field label={m.plates} name="plates" type="number" inputMode="numeric" min={0} max={10} required defaultValue={2} />
            <button className={primary}>{m.save}</button>
          </ActionForm>
        </section>

        <section className={card}>
          <h2 className={h2}>{m.awayTitle}</h2>
          <p className="mt-1 text-muted">{m.awayLead}</p>
          <ActionForm action={awayAction} className="mt-4">
            <input type="hidden" name="lang" value={lang} />
            <Field label={m.from} name="from" type="date" required min={firstOpen} defaultValue={firstOpen} />
            <Field label={m.to} name="to" type="date" required min={firstOpen} defaultValue={firstOpen} />
            <button className={primary}>{m.awayBtn}</button>
          </ActionForm>
        </section>

        {self.inMeals ? (
          <section className={card}>
            <h2 className={h2}>{m.usualTitle}</h2>
            <p className="mt-1 text-muted">{m.usualLead}</p>
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
              <button className={primary}>{m.save}</button>
            </ActionForm>
          </section>
        ) : null}

        <section className={card}>
          <h2 className={h2}>{self.inMeals ? m.ownTitle : m.ownActiveTitle}</h2>
          <p className="mt-1 text-muted">{self.inMeals ? m.ownLead : m.ownActiveLead}</p>
          <form action={inMealsAction} className="mt-4">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="on" value={self.inMeals ? '0' : '1'} />
            <button className={self.inMeals ? secondary : primary}>{self.inMeals ? m.ownOn : m.ownOff}</button>
          </form>
        </section>

        <section className={card}>
          <h2 className={h2}>{m.historyTitle}</h2>
          <p className="mt-1 text-muted">{m.historyLead}</p>
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
      <Nav t={t} lang={lang} current="meals" showFlat={me.role === 'manager'} />
    </>
  );
}
