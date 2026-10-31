import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { flatsFor, RECOVER_COOKIE, recoveryOf } from '@/lib/recovery';
import { ActionForm } from '../action-form';
import { forgotCodeAction, forgotEmailAction, forgotRestartAction, recoverPinAction, recoverSignInAction } from '../actions';
import { EMAIL, WHATSAPP } from '../contacts';
import { getDictionary, hasLocale } from '../dictionaries';
import { Header } from '../header';
import { card, Field, Fold, link, PageSkeleton, PinField, primary, secondary } from '../ui';

export async function generateMetadata({ params }: PageProps<'/[lang]/forgot'>): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = getDictionary(lang);
  return { title: `${t.recover.title} · ${t.brand}${t.brandAccent}` };
}

export default function Forgot({ params }: PageProps<'/[lang]/forgot'>) {
  return <Suspense fallback={<PageSkeleton nav={false} />}><ForgotBody params={params} /></Suspense>;
}

/** One page, three steps; the step comes from this browser's recovery cookie, never from the URL. */
async function ForgotBody({ params }: Pick<PageProps<'/[lang]/forgot'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = getDictionary(lang), r = t.recover, a = t.app;
  const token = (await cookies()).get(RECOVER_COOKIE)?.value;
  const step = token ? await recoveryOf(db, token) : null;
  const flats = step?.proven ? await flatsFor(db, step.email) : [];
  const h1 = 'font-display text-3xl font-bold';
  const box = 'mt-8 md:rounded-3xl md:border md:border-line md:bg-surface md:p-6';
  const contact = `inline-flex min-h-11 items-center ${link}`;
  const restart = (
    <form action={forgotRestartAction} className="mt-6">
      <input type="hidden" name="lang" value={lang} />
      <button className={contact}>{r.other}</button>
    </form>
  );
  const [codeBefore, codeAfter] = r.codeLine.split('{code}');

  return (
    <>
      <Header t={t} lang={lang} path="/forgot" />
      {/* one step of signing in: one centred column on wide screens, not two columns with empty space */}
      <main className="mx-auto max-w-md px-5 pb-16 pt-6 md:max-w-lg md:pt-16">
        {!step ? (
          <>
            <h1 className={h1}>{r.title}</h1>
            <p className="mt-2 text-muted">{r.lead}</p>
            <ActionForm action={forgotEmailAction} className={box}>
              <input type="hidden" name="lang" value={lang} />
              <Field label={r.email} name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} />
              <button className={primary}>{r.send}</button>
            </ActionForm>
          </>
        ) : !step.proven ? (
          <>
            <h1 className={h1}>{r.sentTitle}</h1>
            <p className="mt-2 break-words text-muted">{r.sentLead.replace('{email}', () => step.email)}</p>
            <ActionForm action={forgotCodeAction} className={box}>
              <input type="hidden" name="lang" value={lang} />
              <Field label={r.code} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9০-৯]{6}" minLength={6} maxLength={6} required className="tracking-widest" />
              <button className={primary}>{r.check}</button>
            </ActionForm>
            {restart}
          </>
        ) : !flats.length ? (
          <>
            <h1 className={h1}>{r.none}</h1>
            <p className="mt-2 text-muted">{r.noneLead}</p>
            <div className="mt-4 flex flex-wrap gap-x-6">
              {WHATSAPP && <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className={contact}>{t.footer.whatsapp}</a>}
              {EMAIL && <a href={EMAIL} className={contact}>{t.footer.email}</a>}
            </div>
            {restart}
          </>
        ) : (
          <>
            <h1 className={h1}>{r.flatsTitle}</h1>
            {flats.map(f => (
              <section key={f.memberId} className={`mt-6 ${card}`}>
                <p className="text-muted">{f.flatName}</p>
                <h2 className="text-2xl font-bold">{f.name}</h2>
                <p className="mt-2">{codeBefore}<span className="font-bold tracking-widest">{f.code}</span>{codeAfter}</p>
                <ActionForm action={recoverSignInAction} className="mt-4">
                  <input type="hidden" name="lang" value={lang} />
                  <input type="hidden" name="memberId" value={f.memberId} />
                  <PinField label={a.pin} name="pin" autoComplete="current-password" />
                  <button className={primary}>{r.signIn}</button>
                </ActionForm>
                <div className="mt-4 -mx-5 border-t border-line">
                  <Fold title={r.newPinTitle} level={3} row>
                    <ActionForm action={recoverPinAction}>
                      <input type="hidden" name="lang" value={lang} />
                      <input type="hidden" name="memberId" value={f.memberId} />
                      <PinField label={a.newPin} name="newPin" autoComplete="new-password" />
                      <PinField label={a.newPinAgain} name="pin2" autoComplete="new-password" />
                      <button className={secondary}>{r.setPin}</button>
                    </ActionForm>
                  </Fold>
                </div>
              </section>
            ))}
            {restart}
          </>
        )}
      </main>
    </>
  );
}
