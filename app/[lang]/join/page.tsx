import { notFound } from 'next/navigation';
import { joinByCodeAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { Field, primary } from '../ui';

export default async function JoinByCode({ params }: PageProps<'/[lang]/join'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), a = t.app;
  return (
    <>
      <Header t={t} lang={lang} path="/join" />
      {/* one step of signing in: one centred column on wide screens, not two columns with empty space */}
      <main className="mx-auto max-w-md px-5 pb-16 pt-6 md:max-w-lg md:pt-16">
        <div>
          <h1 className="font-display text-3xl font-bold md:text-4xl">{a.joinTitle}</h1>
          <p className="mt-2 text-lg text-muted">{a.joinLead}</p>
        </div>
        <form action={joinByCodeAction} className="mt-8 space-y-5 md:rounded-3xl md:border md:border-line md:bg-surface md:p-6">
          <input type="hidden" name="lang" value={lang} />
          <Field label={a.code} name="code" required maxLength={12} autoComplete="off" autoCapitalize="characters" className="uppercase tracking-widest" />
          <button className={primary}>{a.joinBtn}</button>
        </form>
      </main>
    </>
  );
}
