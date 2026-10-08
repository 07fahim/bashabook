import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { flatByCode } from '@/lib/auth';
import { db } from '@/lib/db';
import { ActionForm } from '../../action-form';
import { loginAction } from '../../actions';
import { getDictionary, hasLocale } from '../../dictionaries';
import { Header } from '../../header';
import { focus, link, PinField, primary, PageSkeleton } from '../../ui';

type Props = PageProps<'/[lang]/j/[code]'>;

export default function Join({ params, searchParams }: Props) {
  return <Suspense fallback={<PageSkeleton />}><JoinBody params={params} searchParams={searchParams} /></Suspense>;
}

async function JoinBody({ params, searchParams }: Pick<Props, 'params' | 'searchParams'>) {
  const { lang, code } = await params;
  if (!hasLocale(lang)) notFound();
  const { m } = await searchParams;
  const t = getDictionary(lang), a = t.app;
  const flat = await flatByCode(db, code);
  const me = flat?.members.find(x => x.id === m);
  const h1 = 'font-display text-3xl font-bold';

  return (
    <>
      <Header t={t} lang={lang} path={`/j/${code}`} />
      <main className="mx-auto max-w-md px-5 pb-16">
        {!flat ? (
          <>
            <h1 className={h1}>{a.joinTitle}</h1>
            <p role="alert" className="mt-3 font-semibold text-chili">{a.errors.badCode}</p>
            <Link href={`/${lang}/join`} className={`mt-6 inline-block ${link}`}>{a.tryCode}</Link>
          </>
        ) : !me ? (
          <>
            <p className="text-muted">{flat.name}</p>
            <h1 className={h1}>{a.pickName}</h1>
            <p className="mt-2 text-muted">{a.pickLead}</p>
            <ul className="mt-6 grid gap-3">
              {flat.members.map(x => (
                <li key={x.id}>
                  <Link href={`/${lang}/j/${code}?m=${x.id}`} className={`flex min-h-14 items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 text-lg font-semibold ${focus}`}>
                    {x.name}
                    {!x.claimed && <span className="text-[15px] font-normal text-muted">{a.newBadge}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="text-muted">{flat.name}</p>
            <h1 className={h1}>{me.name}</h1>
            <p className="mt-2 text-muted">{!me.claimed ? a.setPinLead : me.must_change_pin ? a.changePinLead : a.enterPinLead}</p>
            <ActionForm action={loginAction} className="mt-8">
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="code" value={code} />
              <input type="hidden" name="memberId" value={me.id} />
              {!me.claimed ? (
                <>
                  <PinField label={a.pin} name="pin" autoComplete="new-password" />
                  <PinField label={a.pinAgain} name="pin2" autoComplete="new-password" />
                </>
              ) : me.must_change_pin ? (
                <>
                  <PinField label={a.oneTimePin} name="pin" autoComplete="one-time-code" />
                  <PinField label={a.newPin} name="newPin" autoComplete="new-password" />
                  <PinField label={a.newPinAgain} name="pin2" autoComplete="new-password" />
                </>
              ) : (
                <PinField label={a.pin} name="pin" autoComplete="current-password" />
              )}
              <button className={primary}>{a.enterBtn}</button>
            </ActionForm>
            <Link href={`/${lang}/j/${code}`} className={`mt-6 inline-block ${link}`}>{a.notYou}</Link>
          </>
        )}
      </main>
    </>
  );
}
