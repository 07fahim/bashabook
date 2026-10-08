import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, mealDecision, MEALS, nowDhaka } from '@/lib/meals';
import { loadMeals } from '@/lib/meals-db';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../action-form';
import { awayAction, guestAction, usualAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay } from '../format';
import { Header } from '../header';
import { MealRow } from '../meal-row';
import { Nav } from '../nav';
import { field, Field, primary } from '../ui';

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
  const meals = await loadMeals(db, me.flatId, today, week[6]);
  const self = meals.members.find(x => x.id === me.memberId)!;
  const decide = (date: string) => mealDecision(date, now, meals.flat.cutoff, meals.flat.strictness);
  const firstOpen = week.find(d => decide(d) === 'open')!;   // tomorrow or the day after
  const card = 'mt-8 rounded-2xl border border-line bg-surface p-5';
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
                {week.map(d => <option key={d} value={d}>{fmtDay(d, lang)}</option>)}
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

        <section className={card}>
          <h2 className={h2}>{m.usualTitle}</h2>
          <p className="mt-1 text-muted">{m.usualLead}</p>
          <ActionForm action={usualAction} className="mt-4">
            <input type="hidden" name="lang" value={lang} />
            <div className="grid grid-cols-3 gap-2">
              {MEALS.map(x => (
                <label key={x} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-muted bg-surface font-semibold has-[:checked]:border-turmeric has-[:checked]:bg-turmeric has-[:checked]:text-on-turmeric">
                  <input type="checkbox" name={x} defaultChecked={self.defaults[x]} className="size-5" />
                  {m.names[x]}
                </label>
              ))}
            </div>
            <button className={primary}>{m.save}</button>
          </ActionForm>
        </section>
      </main>
      <Nav t={t} lang={lang} current="meals" showFlat={me.role === 'manager'} />
    </>
  );
}
