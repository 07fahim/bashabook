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
      <main className="mx-auto max-w-md px-5 pb-16 md:grid md:max-w-5xl md:grid-cols-2 md:items-start md:gap-16 md:pt-6">
        <div>
          <h1 className="font-display text-3xl font-bold md:text-4xl">{a.newTitle}</h1>
          <p className="mt-2 text-lg text-muted">{a.newLead}</p>
          {/* desktop only: fills the side next to the long form */}
          <div className="mt-12 hidden md:block">
            <h2 className="text-xl font-bold">{t.trust.title}</h2>
            <dl className="mt-4 divide-y divide-line border-y border-line">
              {t.trust.points.map(([what, how]) => (
                <div key={what} className="py-4">
                  <dt className="font-semibold">{what}</dt>
                  <dd className="mt-1 text-muted">{how}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <ActionForm action={createFlatAction} className="mt-8 md:mt-0 md:rounded-2xl md:border md:border-line md:bg-surface md:p-8">
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
