import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, mealDecision, nowDhaka } from '@/lib/meals';
import { loadMeals } from '@/lib/meals-db';
import { requireMember } from '@/lib/session';
import { logoutAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay, fmtTime } from '../format';
import { Header } from '../header';
import { MealRow } from '../meal-row';
import { Nav } from '../nav';
import { ShareButton } from '../share-button';
import { focus, link } from '../ui';

export default function Home({ params }: PageProps<'/[lang]/home'>) {
  return <Suspense><HomeBody params={params} /></Suspense>;
}

async function HomeBody({ params }: Pick<PageProps<'/[lang]/home'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), a = t.app, m = t.meals;
  const now = nowDhaka(), tomorrow = addDays(now.slice(0, 10), 1);
  const meals = await loadMeals(db, me.flatId, tomorrow, tomorrow);
  const decision = mealDecision(tomorrow, now, meals.flat.cutoff);
  return (
    <>
      <Header t={t} lang={lang} path="/home" />
      <main className="mx-auto max-w-md px-5 pb-28">
        <p className="text-muted">{me.flatName}</p>
        <h1 className="font-display text-3xl font-bold">{a.hi}, {me.name}</h1>
        <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-xl font-bold">{m.tomorrow} · {fmtDay(tomorrow, lang)}</h2>
          <p className="mt-1 text-[15px] text-muted">
            {decision === 'open' ? m.locksAt.replace('{t}', fmtTime(meals.flat.cutoff)) : m.lockedLate}
          </p>
          <MealRow lang={lang} m={m} meId={me.memberId} date={tomorrow} decision={decision} {...meals} />
          <Link href={`/${lang}/meals`} className={`mt-5 inline-block ${link}`}>{m.seeWeek}</Link>
        </section>
        <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-xl font-bold">{a.shareTitle}</h2>
          <p className="mt-2 text-muted">{a.shareLead}</p>
          <p className="mt-4">
            {a.code}: <span className="font-bold tracking-widest">{me.joinCode}</span>
          </p>
          <ShareButton path={`/${me.lang}/j/${me.joinCode}`} label={a.share} copied={a.copied} />
        </section>
        <form action={logoutAction} className="mt-8">
          <input type="hidden" name="lang" value={lang} />
          <button className={`text-muted underline-offset-4 hover:underline ${focus}`}>{a.logout}</button>
        </form>
      </main>
      <Nav t={t} lang={lang} current="home" showFlat={me.role === 'manager'} />
    </>
  );
}
