import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { CHECK_COOKIE, checkOf } from '@/lib/recovery';
import { ActionForm } from '../action-form';
import { checkBackAction, checkCodeAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { Field, link, PageSkeleton, primary } from '../ui';

export async function generateMetadata({ params }: PageProps<'/[lang]/check'>): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return { title: `${t.recover.sentTitle} · ${t.brand}${t.brandAccent}` };
}

export default function Check({ params }: PageProps<'/[lang]/check'>) {
  return <Suspense fallback={<PageSkeleton nav={false} />}><CheckBody params={params} /></Suspense>;
}

/** The code that proves an email before it is saved; the step comes from this browser's check cookie, never the URL. */
async function CheckBody({ params }: Pick<PageProps<'/[lang]/check'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), r = t.recover;
  const token = (await cookies()).get(CHECK_COOKIE)?.value;
  const step = token ? await checkOf(db, token) : null;
  const h1 = 'font-display text-3xl font-bold';

  return (
    <>
      <Header t={t} lang={lang} path="/check" />
      {/* one step: one centred column on wide screens, like the Forgot page */}
      <main className="mx-auto max-w-md px-5 pb-16 pt-6 md:max-w-lg md:pt-16">
        {!step ? (
          <>
            <h1 className={h1}>{r.again}</h1>
            <Link href={`/${lang}`} className={`mt-6 inline-flex min-h-11 items-center ${link}`}>{r.startAgain}</Link>
          </>
        ) : (
          <>
            <h1 className={h1}>{r.sentTitle}</h1>
            <p className="mt-2 break-words text-muted">{r.checkLead.replace('{email}', () => step.email)}</p>
            <ActionForm action={checkCodeAction} className="mt-8 md:rounded-3xl md:border md:border-line md:bg-surface md:p-6">
              <input type="hidden" name="lang" value={lang} />
              <Field label={r.code} name="code" inputMode="numeric" autoComplete="one-time-code" required className="tracking-widest" />
              <button className={primary}>{r.check}</button>
            </ActionForm>
            <form action={checkBackAction} className="mt-6">
              <input type="hidden" name="lang" value={lang} />
              <button className={`inline-flex min-h-11 items-center ${link}`}>{r.checkBack}</button>
            </form>
          </>
        )}
      </main>
    </>
  );
}
