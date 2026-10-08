import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { listMembers } from '@/lib/auth';
import { db } from '@/lib/db';
import { addDays, headcount, MEALS, todayDhaka } from '@/lib/meals';
import { loadMeals } from '@/lib/meals-db';
import { requireManager } from '@/lib/session';
import { ActionForm } from '../action-form';
import { addMemberAction, cookLinkAction, decideAction, resetPinAction, settingsAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay } from '../format';
import { Header } from '../header';
import { Nav } from '../nav';
import { ShareButton } from '../share-button';
import { Field, focus, link, PinField, primary, secondary } from '../ui';

export default function Manage({ params }: PageProps<'/[lang]/manage'>) {
  return <Suspense><ManageBody params={params} /></Suspense>;
}

async function ManageBody({ params }: Pick<PageProps<'/[lang]/manage'>, 'params'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const me = await requireManager(lang);
  const today = todayDhaka(), tomorrow = addDays(today, 1);
  const [members, meals] = await Promise.all([listMembers(db, me.flatId), loadMeals(db, me.flatId, today, tomorrow)]);
  const t = getDictionary(lang), a = t.app, m = t.meals;
  const tom = headcount(meals.members, meals.changes, tomorrow);
  const tod = headcount(meals.members, meals.changes, today);
  const line = (hc: typeof tom) => MEALS.map(x => `${m.names[x]} ${hc[x]}`).join(' · ');
  const text = `${me.flatName} · ${m.tomorrow}, ${fmtDay(tomorrow, lang)}\n${line(tom)}`;
  const card = 'mt-8 rounded-2xl border border-line bg-surface p-5';
  const h2 = 'text-xl font-bold';
  const small = `min-h-11 px-4 font-semibold ${focus}`;

  return (
    <>
      <Header t={t} lang={lang} path="/manage" />
      <main className="mx-auto max-w-md px-5 pb-28">
        <h1 className="font-display text-3xl font-bold">{me.flatName}</h1>

        <section className={card}>
          <h2 className={h2}>{m.headcountTitle}</h2>
          <p className="mt-1 text-muted">{m.tomorrow} · {fmtDay(tomorrow, lang)}</p>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            {MEALS.map(x => (
              <div key={x} className="rounded-xl bg-paper py-3">
                <dt className="text-[15px] text-muted">{m.names[x]}</dt>
                <dd className="text-4xl font-bold tabular-nums">{tom[x]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[15px] text-muted">{m.today}: {line(tod)}</p>
          <ShareButton text={text} label={m.share} copied={m.copied} />
        </section>

        <section className={card}>
          <h2 className={h2}>{m.requestsTitle}</h2>
          {meals.requests.length === 0 ? (
            <p className="mt-2 text-muted">{m.noRequests}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {meals.requests.map(r => (
                <li key={r.id} className="py-3">
                  <p>
                    <span className="font-semibold">{r.name}</span> · {fmtDay(r.date, lang)} · {m.names[r.meal]}: {r.count > 0 ? `${r.count} ${m.platesShort}` : m.off}
                  </p>
                  <form action={decideAction} className="mt-2 flex gap-2">
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="id" value={r.id} />
                    <button name="approve" value="1" className={`${small} bg-turmeric text-on-turmeric`}>{m.approve}</button>
                    <button name="approve" value="0" className={`${small} border border-muted bg-surface`}>{m.reject}</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className={h2}>{a.members}</h2>
          <ul className="mt-2 divide-y divide-line">
            {members.map(x => (
              <li key={x.id} className="py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-lg font-semibold">{x.name}</span>
                  <span className={`text-[15px] ${x.locked ? 'font-semibold text-chili' : 'text-muted'}`}>
                    {!x.claimed ? a.notJoined : x.locked ? a.lockedBadge : x.failed > 0 ? `${a.failed}: ${x.failed}` : ''}
                  </span>
                </div>
                {x.claimed && x.id !== me.memberId && (
                  <details className="mt-2">
                    <summary className={`cursor-pointer text-[15px] ${link}`}>{a.resetPin}</summary>
                    <p className="mt-2 text-[15px] text-muted">{a.resetLead}</p>
                    <ActionForm action={resetPinAction} className="mt-3">
                      <input type="hidden" name="lang" value={lang} />
                      <input type="hidden" name="memberId" value={x.id} />
                      <PinField label={a.oneTimePin} name="pin" autoComplete="off" />
                      <button className={primary}>{a.resetBtn}</button>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mt-6 font-bold">{a.addMember}</h3>
          <ActionForm action={addMemberAction} className="mt-3">
            <input type="hidden" name="lang" value={lang} />
            <Field label={a.memberName} name="name" required maxLength={40} autoComplete="off" />
            <button className={primary}>{a.addBtn}</button>
          </ActionForm>
        </section>

        <section className={card}>
          <h2 className={h2}>{m.rulesTitle}</h2>
          <ActionForm action={settingsAction} className="mt-4">
            <input type="hidden" name="lang" value={lang} />
            <Field label={m.cutoff} name="cutoff" type="time" required defaultValue={meals.flat.cutoff.slice(0, 5)} />
            <fieldset>
              <legend className="font-semibold">{m.strictness}</legend>
              {(['relaxed', 'strict'] as const).map(s => (
                <label key={s} className="mt-3 flex items-center gap-3">
                  <input type="radio" name="strictness" value={s} defaultChecked={meals.flat.strictness === s} className="size-5" />
                  {s === 'relaxed' ? m.relaxedOpt : m.strictOpt}
                </label>
              ))}
            </fieldset>
            <button className={primary}>{m.save}</button>
          </ActionForm>
        </section>

        <section className={card}>
          <h2 className={h2}>{m.cookTitle}</h2>
          <p className="mt-1 text-muted">{m.cookLead}</p>
          {meals.flat.cookToken && <ShareButton path={`/${meals.flat.lang}/c/${meals.flat.cookToken}`} label={m.share} copied={m.copied} />}
          <form action={cookLinkAction} className="mt-3">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="on" value={meals.flat.cookToken ? '0' : '1'} />
            <button className={meals.flat.cookToken ? secondary : primary}>{meals.flat.cookToken ? m.cookOff : m.cookOn}</button>
          </form>
        </section>
      </main>
      <Nav t={t} lang={lang} current="manage" showFlat />
    </>
  );
}
