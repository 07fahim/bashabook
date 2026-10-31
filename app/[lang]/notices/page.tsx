import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { todayDhaka } from '@/lib/meals';
import { listNotices, type Notice } from '@/lib/notices';
import { requireMember } from '@/lib/session';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtWhen } from '../format';
import { noticeLine } from '../notice-line';
import { Header } from '../header';
import { Nav } from '../nav';
import { SeenNow } from './seen-now';
import { card, ICONS, insetFocus, LongList, PageSkeleton } from '../ui';

/** Which icon each kind gets; a new kind without one fails to compile. A declined handover gets the wallet, not a tick. */
const ICON: Record<Notice['kind'], keyof typeof ICONS> = { paid: 'wallet', handover: 'settle', handoverDone: 'wallet', closeMonth: 'bill', meal: 'meal', account: 'person', rejected: 'wallet', today: 'meal' };

export default function Notices({ params }: PageProps<'/[lang]/notices'>) {
  return <Suspense fallback={<PageSkeleton />}><Body params={params} /></Suspense>;
}

async function Body({ params }: Pick<PageProps<'/[lang]/notices'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), me = await requireMember(lang), today = todayDhaka();
  const rows = (await listNotices(db, me.flatId, me.memberId, me.role === 'manager')).map(n => [n, noticeLine(n, t, lang, today)] as const).filter(([, l]) => l);
  return (
    <>
      <Header t={t} lang={lang} path="/notices" notices={0}><Nav t={t} lang={lang} topic={me.liveTopic} showFlat={me.role === 'manager'} /></Header>
      <main className="mx-auto max-w-7xl px-5 pt-6 pb-28 md:px-8 md:pb-10">
        <SeenNow lang={lang} upTo={rows.map(([n]) => n.at).sort().at(-1) ?? null} />
        <section className={`${card} md:max-w-2xl`}>
          <h1 className="font-display text-2xl font-bold">{t.notices.title}</h1>
          {rows.length === 0 ? <p className="mt-3 text-muted">{t.notices.empty}</p> : (
            <LongList label={t.notices.title} keep={8} more={t.app.showAll.replace('{n}', String(rows.length))} less={t.app.showLess} items={rows.map(([n, l], i) => {
              const [text, href] = l!;
              return (
                <li key={i}>
                  <Link href={href} className={`flex min-h-11 items-center gap-3 rounded-lg py-3 ${insetFocus}`}>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-paper text-turmeric-ink" aria-hidden="true">
                      <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[ICON[n.kind]]} /></svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{text}</span>
                      {n.pending && <span className="ml-2 rounded-full bg-paper px-2 text-[15px] text-ink">{t.notices.waiting}</span>}
                      <span className="mt-1 block text-[15px] text-muted">{fmtWhen(n.at, lang)}</span>
                    </span>
                    <svg className="size-5 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
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
