import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { db } from '@/lib/db';
import { addDays, countChanges, headcount, mealDecision, MEALS, nowDhaka } from '@/lib/meals';
import { listMembers } from '@/lib/auth';
import { countAtLock, loadMeals } from '@/lib/meals-db';
import { loadMonth, monthOf, toConfirm } from '@/lib/money-db';
import { requireMember } from '@/lib/session';
import { ActionForm } from '../action-form';
import { changePinAction, logoutAction, phoneAction, photoAction, removePhotoAction } from '../actions';
import { Avatar } from '../avatar';
import { PhotoPicker } from '../photo-picker';
import { getDictionary, hasLocale } from '../dictionaries';
import { countText, fmtDay, fmtTaka, fmtTime } from '../format';
import { Header } from '../header';
import { LockChange } from '../lock-change';
import { MealRow } from '../meal-row';
import { balanceText, ConfirmList } from '../money/bits';
import { Nav } from '../nav';
import { WeekChart } from '../week-chart';
import { ShareButton } from '../share-button';
import { Field, Fold, focus, link, PageSkeleton, PinField, secondary } from '../ui';

export default function Home({ params }: PageProps<'/[lang]/home'>) {
  return <Suspense fallback={<PageSkeleton />}><HomeBody params={params} /></Suspense>;
}

async function HomeBody({ params }: Pick<PageProps<'/[lang]/home'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const me = await requireMember(lang);
  const t = getDictionary(lang), a = t.app, m = t.meals;
  const now = nowDhaka(), today = now.slice(0, 10), tomorrow = addDays(today, 1);
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [meals, people, mo, waiting] = await Promise.all([
    loadMeals(db, me.flatId, today, week[6]), listMembers(db, me.flatId),
    loadMonth(db, me.flatId, monthOf(today), today), toConfirm(db, me.flatId, me.memberId, me.role === 'manager'),
  ]);
  const x = t.money, mine = mo.result.perMember.find(p => p.id === me.memberId), bal = mine && balanceText(x, mine.balance);
  const someoneMissing = people.some(p => !p.claimed);
  const self = people.find(p => p.id === me.memberId), myPhone = self?.phone ?? '';   // the invite card only matters while someone hasn't joined
  const decide = (date: string) => mealDecision(date, now, meals.flat.cutoff);
  const decision = decide(tomorrow);
  const starter = meals.members.find(x => x.role === 'manager');
  const note = starter?.id === me.memberId ? m.todayLockedSelf : m.todayLocked.replace('{name}', starter?.name ?? '');
  const hc = headcount(meals.members, meals.changes, tomorrow);
  // only after the lock does a change matter: before it, the card already says the count can still move
  const changes = decision === 'open' ? [] : countChanges(await countAtLock(db, me.flatId, tomorrow, hc, now), hc);
  const status = decision === 'open' ? m.finalAt.replace('{t}', fmtTime(meals.flat.cutoff)) : m.final;
  // under the week chart it has to say which day; in the phone card the heading already says tomorrow
  const lockLine = (wide: boolean) => (
    <p className="mt-1 text-[15px] text-muted">
      {(decision === 'open' ? (wide ? m.lockTime : m.locksAt) : `${wide ? `${m.tomorrow}: ` : ''}${m.lockedLate}`).replace('{t}', fmtTime(meals.flat.cutoff))}
      {/* the person who runs the flat can find the lock time setting from here */}
      {me.role === 'manager' && <> · <Link href={`/${lang}/manage?rules=1#rules`} className={`inline-flex min-h-11 items-center ${link}`}>{m.changeTime}</Link></>}
    </p>
  );

  return (
    <>
      <Header t={t} lang={lang} path="/home"><Nav t={t} lang={lang} current="home" showFlat={me.role === 'manager'} /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        <p className="text-muted">{me.flatName}</p>
        <div className="flex items-center gap-3">
          <Avatar id={me.memberId} name={me.name} v={self?.photoV ?? null} size={48} />
          <h1 className="font-display text-3xl font-bold">{a.hi}, {me.name}</h1>
        </div>
        {/* side by side the cards are one height, their buttons on one line; a lone card keeps half the row,
            not a button as wide as the screen */}
        {waiting.length > 0 && <div className="mt-6"><ConfirmList lang={lang} x={x} items={waiting} collector={starter?.name ?? ''} /></div>}
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {/* phones only: wider screens change tomorrow in the week chart, with the lock time above it */}
          <section className="rounded-3xl border border-line bg-surface p-5 md:hidden">
            <h2 className="text-xl font-bold">{m.tomorrow} · {fmtDay(tomorrow, lang)}</h2>
            {lockLine(false)}
            <MealRow lang={lang} m={m} meId={me.memberId} date={tomorrow} decision={decision} {...meals} />
            <Link href={`/${lang}/meals`} className={`mt-3 inline-flex min-h-11 items-center ${link}`}>{m.seeWeek}</Link>
          </section>
          <section className="flex flex-col rounded-3xl border border-line bg-surface p-5">
            <h2 className="text-xl font-bold">{m.headcountTitle}</h2>
            <p className="mt-1 text-[15px] text-muted">{m.tomorrow} · {fmtDay(tomorrow, lang)} · {status}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {MEALS.map(x => (
                <div key={x} className="rounded-xl bg-paper py-3">
                  <dt className="text-[15px] text-muted">{m.names[x]}</dt>
                  <dd className="text-3xl font-bold tabular-nums">{hc[x]}</dd>
                </div>
              ))}
            </dl>
            <LockChange m={m} lang={lang} date={tomorrow} hc={hc} changes={changes} />
            <div className="grow" />
            <ShareButton text={countText(me.flatName, m, tomorrow, hc, status, lang)} label={m.share} copied={m.copied} />
          </section>
          {bal && <section className="flex flex-col rounded-3xl border border-line bg-surface p-5">
            <h2 className="text-xl font-bold">{x.title}</h2>
            <p className={`mt-2 text-lg font-semibold ${bal.tone}`}>{bal.text}</p>
            <p className="mt-1 text-[15px] text-muted">{x.mealRate}: {fmtTaka(mo.result.mealRate)}</p>
            <div className="grow" />
            <Link href={`/${lang}/money`} className={`mt-3 inline-flex min-h-11 items-center ${link}`}>{x.seeMoney}</Link>
          </section>}
          {someoneMissing && <section className="flex flex-col rounded-3xl border border-line bg-surface p-5">
            <h2 className="text-xl font-bold">{a.shareTitle}</h2>
            <p className="mt-2 text-muted">{a.shareLead}</p>
            <p className="mt-4">
              {a.code}: <span className="font-bold tracking-widest">{me.joinCode}</span>
            </p>
            <div className="grow" />
            <ShareButton path={`/${me.lang}/j/${me.joinCode}`} label={a.share} copied={a.copied} />
          </section>}
        </div>
        {/* wider screens: the whole week at a glance, phones use the Meals tab */}
        <div className="mt-10 hidden md:block">
          {/* other weeks live on the Meals tab, which has the arrows */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-6">
            <h2 className="text-2xl font-bold">{m.weekTitle}</h2>
            <Link href={`/${lang}/meals?week=1`} className={`inline-flex min-h-11 items-center gap-2 ${link}`}>{m.nextWeek} <span aria-hidden="true">→</span></Link>
          </div>
          <div className="mb-4">{lockLine(true)}</div>
          <WeekChart lang={lang} m={m} meId={me.memberId} today={today} week={week} decide={decide} note={note} {...meals} />
        </div>
        <div className="mt-10 grid gap-x-6 md:grid-cols-2 md:items-start">
          <Fold title={a.flatmates}>
            <ul className="mt-2 divide-y divide-line">
              {people.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-3"><Avatar id={p.id} name={p.name} v={p.photoV} size={32} />
                    <span>
                      {p.name}{p.id === me.memberId && <span className="text-muted"> · {a.you}</span>}
                      {/* on its own line, so a phone still has room for the name and the number */}
                      {(p.leftOn || p.joinedOn > today) && <span className="block text-[15px] text-muted">{p.leftOn ? a.lastDayBadge.replace('{d}', fmtDay(p.leftOn, lang)) : a.movingInBadge.replace('{d}', fmtDay(p.joinedOn, lang))}</span>}
                    </span>
                  </span>
                  {p.phone ? <a href={`tel:${p.phone}`} aria-label={`${a.call} ${p.name}`} className={`inline-flex min-h-11 items-center tabular-nums ${link}`}>{p.phone}</a>
                    : <span className="text-[15px] text-muted">{a.noPhone}</span>}
                </li>
              ))}
            </ul>
          </Fold>
          <Fold title={a.myAccount}>
            <div className="mt-4 flex items-center gap-4">
              <Avatar id={me.memberId} name={me.name} v={self?.photoV ?? null} size={64} />
              <div className="flex-1">
                {/* two separate forms: the upload form handles its own submit, so removing can't go through it */}
                <div className="flex flex-wrap items-start gap-x-4">
                  <ActionForm action={photoAction}>
                    <input type="hidden" name="lang" value={lang} />
                    <PhotoPicker label={self?.photoV != null ? a.changePhoto : a.addPhoto} />
                  </ActionForm>
                  {self?.photoV != null && (
                    <form action={removePhotoAction}>
                      <input type="hidden" name="lang" value={lang} />
                      <input type="hidden" name="memberId" value={me.memberId} />
                      <button className={`inline-flex min-h-11 items-center text-[15px] ${link}`}>{a.removePhoto}</button>
                    </form>
                  )}
                </div>
                <p className="text-[15px] text-muted">{a.photoHint}</p>
              </div>
            </div>
            <ActionForm action={phoneAction} className="mt-6 border-t border-line pt-6">
              <input type="hidden" name="lang" value={lang} />
              {/* keyed on the saved number, so after a save the field shows it as stored (01712345678) */}
              <Field key={myPhone} label={a.phone} hint={a.phoneHint} name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={myPhone} className="sm:max-w-xs" />
              {/* settings are quiet (outlined): the bright buttons stay for the page's main actions */}
              <button className={`${secondary} sm:w-auto`}>{a.savePhone}</button>
            </ActionForm>
            <div className="mt-8 border-t border-line pt-6">
              <h3 className="text-lg font-bold">{a.changePin}</h3>
              <ActionForm action={changePinAction} className="mt-4" clearOnDone>
                <input type="hidden" name="lang" value={lang} />
                {/* a 4-digit PIN needs a short box: three side by side on wider screens */}
                <div className="grid gap-5 sm:grid-cols-3">
                  <PinField label={a.currentPin} name="pin" autoComplete="current-password" />
                  <PinField label={a.newPin} name="newPin" autoComplete="new-password" />
                  <PinField label={a.newPinAgain} name="pin2" autoComplete="new-password" />
                </div>
                <button className={`${secondary} sm:w-auto`}>{a.changePin}</button>
              </ActionForm>
            </div>
          </Fold>
        </div>
        <form action={logoutAction} className="mt-8">
          <input type="hidden" name="lang" value={lang} />
          <button className={`inline-flex min-h-11 items-center text-muted underline-offset-4 hover:underline ${focus}`}>{a.logout}</button>
        </form>
      </main>
    </>
  );
}
