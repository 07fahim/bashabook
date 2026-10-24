import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { flatByCode } from '@/lib/auth';
import { db } from '@/lib/db';
import { todayDhaka } from '@/lib/meals';
import { allow, firstIp } from '@/lib/rate-limit';
import { ActionForm } from '../../action-form';
import { loginAction } from '../../actions';
import { getDictionary, hasLocale } from '../../dictionaries';
import { fmtDay } from '../../format';
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
  // code lookups are counted per connection and hour, so a script can't guess codes or burn the database
  const ok = await allow(db, `join:${firstIp((await headers()).get('x-forwarded-for'))}`, 120);
  const flat = ok ? await flatByCode(db, code) : null;
  const me = flat?.members.find(x => x.id === m);
  const h1 = 'font-display text-3xl font-bold';

  return (
    <>
      <Header t={t} lang={lang} path={`/j/${code}`} />
      {/* one step of signing in: one centred column on wide screens, not two columns with empty space */}
      <main className="mx-auto max-w-md px-5 pb-16 pt-6 md:max-w-lg md:pt-16">
        {!flat ? (
          <div>
            <h1 className={h1}>{a.joinTitle}</h1>
            <p role="alert" className="mt-3 font-semibold text-chili">{ok ? a.errors.badCode : a.errors.tooMany}</p>
            <Link href={`/${lang}/join`} className={`mt-6 inline-flex min-h-11 items-center ${link}`}>{a.tryCode}</Link>
          </div>
        ) : !me ? (
          <>
            <div>
              <p className="text-muted">{flat.name}</p>
              <h1 className={h1}>{a.pickName}</h1>
              <p className="mt-2 text-muted">{a.pickLead}</p>
            </div>
            <ul className="mt-6 grid grid-cols-1 gap-3">
              {flat.members.map(x => (
                <li key={x.id}>
                  <Link href={`/${lang}/j/${code}?m=${x.id}`} className={`flex min-h-14 items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 text-lg font-semibold ${focus}`}>
                    {x.name}
                    {!x.claimed && <span className="text-[15px] font-normal text-muted">{x.leftOn ? a.lastDayBadge.replace('{d}', fmtDay(x.leftOn, lang)) : x.joinedOn > todayDhaka() ? a.movingInBadge.replace('{d}', fmtDay(x.joinedOn, lang)) : a.newBadge}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div>
              <p className="text-muted">{flat.name}</p>
              <h1 className={h1}>{me.name}</h1>
              <p className="mt-2 text-muted">{!me.claimed ? a.setPinLead : me.must_change_pin ? a.changePinLead : a.enterPinLead}</p>
            </div>
            <div>
            <ActionForm action={loginAction} className="mt-8 md:rounded-3xl md:border md:border-line md:bg-surface md:p-6">
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
            <Link href={`/${lang}/j/${code}`} className={`mt-6 inline-flex min-h-11 items-center ${link}`}>{a.notYou}</Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}
