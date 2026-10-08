import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { requireMember } from '@/lib/session';
import { logoutAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { ShareButton } from '../share-button';
import { focus, link } from '../ui';

export default function Home({ params }: PageProps<'/[lang]/home'>) {
  return <Suspense><HomeBody params={params} /></Suspense>;
}

async function HomeBody({ params }: Pick<PageProps<'/[lang]/home'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), a = t.app;
  return (
    <>
      <Header t={t} lang={lang} path="/home" />
      <main className="mx-auto max-w-md px-5 pb-16">
        <p className="text-muted">{me.flatName}</p>
        <h1 className="font-display text-3xl font-bold">{a.hi}, {me.name}</h1>
        <p className="mt-2 text-muted">{a.homeLead}</p>
        <section className="mt-8 rounded-2xl border border-line bg-surface p-6">
          <h2 className="text-xl font-bold">{a.shareTitle}</h2>
          <p className="mt-2 text-muted">{a.shareLead}</p>
          <p className="mt-4">
            {a.code}: <span className="font-bold tracking-widest">{me.joinCode}</span>
          </p>
          <ShareButton path={`/${me.lang}/j/${me.joinCode}`} label={a.share} copied={a.copied} />
        </section>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
          {me.role === 'manager' && <Link href={`/${lang}/manage`} className={link}>{a.members}</Link>}
          <form action={logoutAction}>
            <input type="hidden" name="lang" value={lang} />
            <button className={`text-muted underline-offset-4 hover:underline ${focus}`}>{a.logout}</button>
          </form>
        </div>
      </main>
    </>
  );
}
