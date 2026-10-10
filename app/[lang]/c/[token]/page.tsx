import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, headcount, isLocked, MEALS, nowDhaka, todayDhaka, type Meal } from '@/lib/meals';
import { flatIdByCookToken, loadMeals } from '@/lib/meals-db';
import { getDictionary, hasLocale } from '../../dictionaries';
import { fmtDay, fmtTime } from '../../format';
import { PageSkeleton } from '../../ui';
import { Header } from '../../header';

type Props = PageProps<'/[lang]/c/[token]'>;

// The token is the only key: keep it out of search results and Referer headers.
export const metadata = { robots: { index: false }, referrer: 'no-referrer' as const };

export default function Cook({ params }: Props) {
  return <Suspense fallback={<PageSkeleton />}><CookBody params={params} /></Suspense>;
}

/** The cook's view: plates for tomorrow (big) and today. No login. */
async function CookBody({ params }: Pick<Props, 'params'>) {
  const { lang, token } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), m = t.meals;
  const flatId = await flatIdByCookToken(db, token);
  const today = todayDhaka(), tomorrow = addDays(today, 1);
  const data = flatId ? await loadMeals(db, flatId, today, tomorrow) : null;
  const days = [{ date: tomorrow, label: m.tomorrow, big: true }, { date: today, label: m.today, big: false }];

  return (
    <>
      <Header t={t} lang={lang} path={`/c/${token}`} />
      <main className="mx-auto max-w-md px-5 pt-6 pb-16">
        {!data ? (
          <p role="alert" className="font-semibold text-chili">{m.cookGone}</p>
        ) : (
          <>
            <h1 className="text-2xl font-bold">{data.flat.name}</h1>
            {days.map(({ date, label, big }) => {
              const hc = headcount(data.members, data.changes, date);
              // a meal blocked by no cooking says so; if the starter still put plates on it, the number shows as usual
              const off = (x: Meal) => hc[x] === 0 && data.noCook.some(n => n.date === date && n.meal === x);
              return (
                <section key={date} className="mt-6">
                  <h2 className={`${big ? 'text-3xl' : 'text-xl'} font-bold`}>{label} · {fmtDay(date, lang)}</h2>
                  {big && <p className="mt-1 text-lg text-muted">{isLocked(date, nowDhaka(), data.flat.cutoff) ? m.final : m.finalAt.replace('{t}', fmtTime(data.flat.cutoff))}</p>}
                  <dl className="mt-3 divide-y divide-line border-y border-line">
                    {MEALS.map(x => (
                      <div key={x} className="flex items-baseline justify-between py-3">
                        <dt className={big ? 'text-3xl' : 'text-xl'}>{m.names[x]}</dt>
                        {off(x) ? <dd className={`${big ? 'text-2xl' : 'text-xl'} font-bold`}>{m.noCook}</dd>
                          : <dd className={`${big ? 'text-7xl' : 'text-4xl'} font-bold tabular-nums`}>{hc[x]}</dd>}
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })}
          </>
        )}
      </main>
    </>
  );
}
