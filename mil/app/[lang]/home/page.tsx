import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, headcount, mealDecision, MEALS, nowDhaka } from '@/lib/meals';
import { loadMeals } from '@/lib/meals-db';
import { requireMember } from '@/lib/session';
import { logoutAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay, fmtTime } from '../format';
import { Header } from '../header';
import { MealRow } from '../meal-row';
import { Nav } from '../nav';
import { ShareButton } from '../share-button';
import { focus, link, PageSkeleton } from '../ui';

export default function Home({ params }: PageProps<'/[lang]/home'>) {
  return <Suspense fallback={<PageSkeleton />}><HomeBody params={params} /></Suspense>;
}

async function HomeBody({ params }: Pick<PageProps<'/[lang]/home'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), a = t.app, m = t.meals;
  const now = nowDhaka(), tomorrow = addDays(now.slice(0, 10), 1);
  const meals = await loadMeals(db, me.flatId, tomorrow, tomorrow);
  const decision = mealDecision(tomorrow, now, meals.flat.cutoff);
  const hc = headcount(meals.members, meals.changes, tomorrow);
  return (
    <>
      <Header t={t} lang={lang} path="/home"><Nav t={t} lang={lang} current="home" showFlat={me.role === 'manager'} /></Header>
      <div className="md:pl-60">
      <main className="mx-auto max-w-md px-5 pb-28 md:max-w-6xl md:px-10 md:pt-10 md:pb-16">
        <p className="text-muted">{me.flatName}</p>
        <h1 className="font-display text-3xl font-bold">{a.hi}, {me.name}</h1>
        <div className="mt-8 grid gap-6 md:grid-cols-2 md:items-start xl:grid-cols-3">
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xl font-bold">{m.tomorrow} · {fmtDay(tomorrow, lang)}</h2>
            <p className="mt-1 text-[15px] text-muted">
              {decision === 'open' ? m.locksAt.replace('{t}', fmtTime(meals.flat.cutoff)) : m.lockedLate}
            </p>
            <MealRow lang={lang} m={m} meId={me.memberId} date={tomorrow} decision={decision} {...meals} />
            <Link href={`/${lang}/meals`} className={`mt-5 inline-block ${link}`}>{m.seeWeek}</Link>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xl font-bold">{m.headcountTitle}</h2>
            <p className="mt-1 text-[15px] text-muted">{m.tomorrow} · {fmtDay(tomorrow, lang)}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {MEALS.map(x => (
                <div key={x} className="rounded-xl bg-paper py-3">
                  <dt className="text-[15px] text-muted">{m.names[x]}</dt>
                  <dd className="text-3xl font-bold tabular-nums">{hc[x]}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xl font-bold">{a.shareTitle}</h2>
            <p className="mt-2 text-muted">{a.shareLead}</p>
            <p className="mt-4">
              {a.code}: <span className="font-bold tracking-widest">{me.joinCode}</span>
            </p>
            <ShareButton path={`/${me.lang}/j/${me.joinCode}`} label={a.share} copied={a.copied} />
          </section>
        </div>
        <form action={logoutAction} className="mt-8">
          <input type="hidden" name="lang" value={lang} />
          <button className={`text-muted underline-offset-4 hover:underline ${focus}`}>{a.logout}</button>
        </form>
      </main>
      </div>
    </>
  );
}
