import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { link, PageSkeleton } from '../ui';

export async function generateMetadata({ params }: PageProps<'/[lang]/confirm'>): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return { title: `${t.recover.confirmTitle} · ${t.brand}${t.brandAccent}` };
}

export default function Confirm({ params, searchParams }: PageProps<'/[lang]/confirm'>) {
  return <Suspense fallback={<PageSkeleton nav={false} />}><ConfirmBody params={params} searchParams={searchParams} /></Suspense>;
}

async function ConfirmBody({ params, searchParams }: Pick<PageProps<'/[lang]/confirm'>, 'params' | 'searchParams'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const good = (await searchParams).ok === '1';
  const t = getDictionary(lang), r = t.recover;
  return (
    <>
      <Header t={t} lang={lang} path={`/confirm?ok=${good ? 1 : 0}`} />
      <main className="mx-auto max-w-md px-5 pb-16 pt-6 md:max-w-lg md:pt-16">
        <h1 className="font-display text-3xl font-bold">{good ? r.confirmedTitle : r.staleTitle}</h1>
        <p className="mt-2 text-muted">{good ? r.confirmedLead : r.staleLead}</p>
        <Link href={`/${lang}/home`} className={`mt-6 inline-flex min-h-11 items-center ${link}`}>{r.openApp}</Link>
      </main>
    </>
  );
}
