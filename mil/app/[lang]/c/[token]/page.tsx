import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, headcount, MEALS, todayDhaka } from '@/lib/meals';
import { flatIdByCookToken, loadMeals } from '@/lib/meals-db';
import { getDictionary, hasLocale } from '../../dictionaries';
import { fmtDay } from '../../format';
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
      <main className="mx-auto max-w-md px-5 pb-16">
        {!data ? (
          <p role="alert" className="font-semibold text-chili">{m.cookGone}</p>
        ) : (
          <>
            <p className="text-lg text-muted">{data.flat.name}</p>
            {days.map(({ date, label, big }) => {
              const hc = headcount(data.members, data.changes, date);
              return (
                <section key={date} className="mt-6">
                  <h2 className={`${big ? 'text-3xl' : 'text-xl'} font-bold`}>{label} · {fmtDay(date, lang)}</h2>
                  <dl className="mt-3 divide-y divide-line border-y border-line">
                    {MEALS.map(x => (
                      <div key={x} className="flex items-baseline justify-between py-3">
                        <dt className={big ? 'text-3xl' : 'text-xl'}>{m.names[x]}</dt>
                        <dd className={`${big ? 'text-7xl' : 'text-4xl'} font-bold tabular-nums`}>{hc[x]}</dd>
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
