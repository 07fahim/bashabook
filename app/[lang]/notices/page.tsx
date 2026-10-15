import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { todayDhaka } from '@/lib/meals';
import { listNotices, markNoticesSeen } from '@/lib/notices';
import { requireMember } from '@/lib/session';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtWhen } from '../format';
import { noticeLine } from '../notice-line';
import { Header } from '../header';
import { Nav } from '../nav';
import { card, focus, LongList, PageSkeleton } from '../ui';

export default function Notices({ params }: PageProps<'/[lang]/notices'>) {
  return <Suspense fallback={<PageSkeleton />}><Body params={params} /></Suspense>;
}

async function Body({ params }: Pick<PageProps<'/[lang]/notices'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), me = await requireMember(lang), today = todayDhaka();
  await markNoticesSeen(db, me.flatId, me.memberId);   // seen first: the bell on this page shows no count
  const rows = (await listNotices(db, me.flatId, me.memberId, me.role === 'manager')).map(n => [n, noticeLine(n, t, lang, today)] as const).filter(([, l]) => l);
  return (
    <>
      <Header t={t} lang={lang} path="/notices" notices={0}><Nav t={t} lang={lang} showFlat={me.role === 'manager'} /></Header>
      <main className="mx-auto max-w-7xl px-5 pt-6 pb-28 md:px-8 md:pb-10">
        <section className={`${card} md:max-w-2xl`}>
          <h1 className="font-display text-2xl font-bold">{t.notices.title}</h1>
          {rows.length === 0 ? <p className="mt-3 text-muted">{t.notices.empty}</p> : (
            <LongList label={t.notices.title} keep={8} more={t.app.showAll.replace('{n}', String(rows.length))} less={t.app.showLess} items={rows.map(([n, l], i) => {
              const [text, href] = l!;
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
