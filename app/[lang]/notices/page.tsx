import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { todayDhaka } from '@/lib/meals';
import { listNotices, markNoticesSeen, type Notice } from '@/lib/notices';
import { requireMember } from '@/lib/session';
import { getDictionary, hasLocale, type Dict, type Locale } from '../dictionaries';
import { fmtDay, fmtMonth, fmtTaka, fmtWhen } from '../format';
import { Header } from '../header';
import { Nav } from '../nav';
import { card, focus, LongList, PageSkeleton } from '../ui';

export default function Notices({ params }: PageProps<'/[lang]/notices'>) {
  return <Suspense fallback={<PageSkeleton />}><Body params={params} /></Suspense>;
}

/** One line per notice, and the screen it leads to. */
function line(n: Notice, t: Dict, lang: Locale, today: string): [string, string] {
  const x = t.notices, d = n.detail ?? {};
  const meal = n.meal ? t.meals.names[n.meal as 'b' | 'l' | 'd'] : '';
  const date = n.date ? fmtDay(n.date, lang) : '';
  const fill = (s: string) => s.replace('{name}', n.actor ?? '').replace('{amount}', fmtTaka(n.amount ?? 0)).replace('{meal}', meal).replace('{date}', date).replace('{month}', n.month ? fmtMonth(n.month) : '');
  switch (n.kind) {
    case 'paid': return [fill(d.type === 'deposit' ? x.paidDeposit : x.paidPayout), `/${lang}/home`];
    case 'handover': return [fill(x.handover), `/${lang}/home`];
    case 'handoverDone': return [fill(d.status === 'accepted' ? x.accepted : x.declined), `/${lang}/money`];
    case 'closeMonth': return [fill(x.closeMonth), `/${lang}/money?m=${n.month!.slice(0, 7)}`];
    case 'meal': {
      // after = {count, guests, late} as saveMeal wrote it; the week index is days from today, 7 per week, as the Meals page counts
      const guests = Number(d.guests ?? 0), own = Number(d.count ?? 0) - guests;
      const week = Math.floor((Date.parse(n.date!) - Date.parse(today)) / 864e5 / 7);
      return [fill(guests > 0 ? x.guests : own > 0 ? x.mealOn : x.mealOff), `/${lang}/meals${week ? `?week=${week}` : ''}`];
    }
    case 'account': {
      const text = 'pinReset' in d ? x.pinReset : 'lockCleared' in d ? x.lockCleared : 'rename' in d ? x.rename : 'back' in d ? x.back : x.leaving;
      return [fill(text).replace('{date}', typeof d.left === 'string' ? fmtDay(d.left, lang) : ''), `/${lang}/home`];
    }
  }
}

async function Body({ params }: Pick<PageProps<'/[lang]/notices'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), me = await requireMember(lang), today = todayDhaka();
  await markNoticesSeen(db, me.flatId, me.memberId);   // seen first: the bell on this page shows no count
  const notices = await listNotices(db, me.flatId, me.memberId, me.role === 'manager');
  return (
    <>
      <Header t={t} lang={lang} path="/notices" notices={0}><Nav t={t} lang={lang} current="home" showFlat={me.role === 'manager'} /></Header>
      <main className="mx-auto max-w-7xl px-5 pt-6 pb-28 md:px-8 md:pb-10">
        <section className={`${card} md:max-w-2xl`}>
          <h1 className="font-display text-2xl font-bold">{t.notices.title}</h1>
          {notices.length === 0 ? <p className="mt-3 text-muted">{t.notices.empty}</p> : (
            <LongList label={t.notices.title} keep={8} more={t.app.showAll.replace('{n}', String(notices.length))} less={t.app.showLess} items={notices.map((n, i) => {
              const [text, href] = line(n, t, lang, today);
              return (
                <li key={i} className="py-3">
                  <Link href={href} className={`block rounded-lg ${focus}`}>
                    <span className="font-semibold">{text}</span>
                    {n.pending && <span className="ml-2 rounded-full bg-paper px-2 text-[15px] text-ink">{t.notices.waiting}</span>}
                    <span className="mt-1 block text-[15px] text-muted">{fmtWhen(n.at, lang)}</span>
                  </Link>
                </li>
              );
            })} />
          )}
        </section>
      </main>
    </>
  );
}
