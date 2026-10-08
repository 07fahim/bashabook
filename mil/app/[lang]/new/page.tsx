import { notFound } from 'next/navigation';
import { ActionForm } from '../action-form';
import { createFlatAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { field, Field, PinField, primary } from '../ui';

export default async function NewFlat({ params }: PageProps<'/[lang]/new'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), a = t.app;
  return (
    <>
      <Header t={t} lang={lang} path="/new" />
      <main className="mx-auto max-w-md px-5 pb-16">
        <h1 className="font-display text-3xl font-bold">{a.newTitle}</h1>
        <p className="mt-2 text-muted">{a.newLead}</p>
        <ActionForm action={createFlatAction} className="mt-8">
          <input type="hidden" name="lang" value={lang} />
          <Field label={a.flatName} name="flatName" hint={a.flatNameHint} required maxLength={40} />
          <Field label={a.yourName} name="name" required maxLength={40} autoComplete="given-name" />
          <PinField label={a.pin} name="pin" autoComplete="new-password" />
          <PinField label={a.pinAgain} name="pin2" autoComplete="new-password" />
          <label className="block font-semibold">
            {a.others}
            <textarea name="others" rows={5} className={field} aria-describedby="others-hint" />
            <span id="others-hint" className="mt-1 block text-[15px] font-normal text-muted">{a.othersHint}</span>
          </label>
          <button className={primary}>{a.createBtn}</button>
        </ActionForm>
      </main>
    </>
  );
}
