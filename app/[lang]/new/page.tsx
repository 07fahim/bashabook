import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ActionForm } from '../action-form';
import { createFlatAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { field, Field, PinField, primary } from '../ui';

export async function generateMetadata({ params }: PageProps<'/[lang]/new'>): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return { title: `${t.app.newTitle} · ${t.brand}${t.brandAccent}` };
}

export default async function NewFlat({ params }: PageProps<'/[lang]/new'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), a = t.app;
  return (
    <>
      <Header t={t} lang={lang} path="/new" />
      {/* one step of signing in: one centred column on wide screens, not two columns with empty space */}
      <main className="mx-auto max-w-md px-5 pb-16 pt-6 md:max-w-lg md:pt-16">
        <div>
          <h1 className="font-display text-3xl font-bold md:text-4xl">{a.newTitle}</h1>
          <p className="mt-2 text-lg text-muted">{a.newLead}</p>
        </div>
        <ActionForm action={createFlatAction} className="mt-8 md:rounded-3xl md:border md:border-line md:bg-surface md:p-6">
          <input type="hidden" name="lang" value={lang} />
          <Field label={a.flatName} name="flatName" hint={a.flatNameHint} required maxLength={40} />
          <Field label={a.yourName} name="name" required maxLength={40} autoComplete="given-name" />
          <PinField label={a.pin} name="pin" autoComplete="new-password" />
          <PinField label={a.pinAgain} name="pin2" autoComplete="new-password" />
          <label className="block font-semibold">
            {a.others}
            <textarea name="others" rows={4} className={field} aria-describedby="others-hint" />
            <span id="others-hint" className="mt-1 block text-[15px] font-normal text-muted">{a.othersHint}</span>
          </label>
          <button className={primary}>{a.createBtn}</button>
        </ActionForm>
      </main>
    </>
  );
}
