import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { listMembers } from '@/lib/auth';
import { db } from '@/lib/db';
import { addDays, editFrom, headcount, isLocked, MEALS, nowDhaka, todayDhaka } from '@/lib/meals';
import { loadMeals } from '@/lib/meals-db';
import { requireManager } from '@/lib/session';
import { ActionForm } from '../action-form';
import { addMemberAction, adminMealAction, cookLinkAction, decideAction, noCookAction, resetPinAction, settingsAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay } from '../format';
import { Header } from '../header';
import { Nav } from '../nav';
import { ShareButton } from '../share-button';
import { checkChip, field, Field, Fold, focus, groupLabel, link, PinField, primary, secondary } from '../ui';

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
  const card = 'mt-3 rounded-2xl border border-line bg-surface p-5';
  const own = new Set(meals.members.filter(x => !x.inMeals).map(x => x.id));
  const from = editFrom(today), to = addDays(today, 60);
  const firstOpen = isLocked(tomorrow, nowDhaka(), meals.flat.cutoff) ? addDays(tomorrow, 1) : tomorrow;
  const h2 = 'text-xl font-bold';
  const small = `min-h-11 px-4 font-semibold ${focus}`;

  return (
    <>
      <Header t={t} lang={lang} path="/manage" />
      <main className="mx-auto max-w-md px-5 pb-28">
        <h1 className="font-display text-3xl font-bold">{me.flatName}</h1>

        <h2 className={groupLabel}>{m.groupToday}</h2>
        <section className={card}>
          <h3 className={h2}>{m.headcountTitle}</h3>
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

        {meals.requests.length > 0 && (
          <section className={card}>
            <h3 className={h2}>{m.requestsTitle}</h3>
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
          </section>
        )}

        <h2 className={groupLabel}>{m.groupChange}</h2>
        <Fold title={m.editTitle} lead={m.editLead}>
          <ActionForm action={adminMealAction} className="mt-4">
            <input type="hidden" name="lang" value={lang} />
            <label className="block font-semibold">
              {m.who}
              <select name="memberId" className={field}>
                {members.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <Field label={m.day} name="date" type="date" required min={from} max={to} defaultValue={today} />
            <label className="block font-semibold">
              {m.meal}
              <select name="meal" defaultValue="l" className={field}>
                {MEALS.map(x => <option key={x} value={x}>{m.names[x]}</option>)}
              </select>
            </label>
            <Field label={m.plates} name="plates" hint={m.plateHint} type="number" inputMode="numeric" min={0} max={10} required defaultValue={0} />
            <button className={primary}>{m.save}</button>
          </ActionForm>
        </Fold>

        <Fold title={m.noCookTitle} lead={m.noCookLead}>
          <ActionForm action={noCookAction} className="mt-4">
            <input type="hidden" name="lang" value={lang} />
            <Field label={m.from} name="from" type="date" required min={from} max={to} defaultValue={today} />
            <Field label={m.to} name="to" type="date" required min={from} max={to} defaultValue={today} />
            <fieldset>
              <legend className="font-semibold">{m.whichMeals}</legend>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {MEALS.map(x => (
                  <label key={x} className={checkChip}>
                    <input type="checkbox" name={x} defaultChecked className="size-5 shrink-0 accent-ink" />
                    {m.names[x]}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className={primary}>{m.noCookBtn}</button>
            <p className="text-[15px] text-muted">{m.noCookAgainLead}</p>
            <button name="again" value="1" className={secondary}>{m.noCookAgain}</button>
          </ActionForm>
        </Fold>

        <h2 className={groupLabel}>{a.members}</h2>
        <section className={card}>
          <ul className="divide-y divide-line">
            {members.map(x => (
              <li key={x.id} className="py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-lg font-semibold">{x.name}</span>
                  <span className={`text-[15px] ${x.locked ? 'font-semibold text-chili' : 'text-muted'}`}>
                    {!x.claimed ? a.notJoined : x.locked ? a.lockedBadge : x.failed > 0 ? `${a.failed}: ${x.failed}` : own.has(x.id) ? m.ownBadge : ''}
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
            <Field label={m.joinedOn} name="joinedOn" type="date" required min={firstOpen} max={to} defaultValue={firstOpen} />
            <button className={primary}>{a.addBtn}</button>
          </ActionForm>
        </section>

        <h2 className={groupLabel}>{m.groupSettings}</h2>
        <Fold title={m.rulesTitle}>
          <ActionForm action={settingsAction} className="mt-4">
            <input type="hidden" name="lang" value={lang} />
            <Field label={m.cutoff} name="cutoff" type="time" required defaultValue={meals.flat.cutoff.slice(0, 5)} />
            <fieldset>
              <legend className="font-semibold">{m.weights}</legend>
              <p className="text-[15px] text-muted">{m.weightsHint}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {MEALS.map(x => (
                  <Field key={x} label={m.names[x]} name={`w_${x}`} type="number" inputMode="decimal" min={0} max={10} step={0.01} required defaultValue={meals.flat.weights[x] / 100} />
                ))}
              </div>
            </fieldset>
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
        </Fold>

        <Fold title={m.cookTitle} lead={m.cookLead}>
          {meals.flat.cookToken && <ShareButton path={`/${meals.flat.lang}/c/${meals.flat.cookToken}`} label={m.share} copied={m.copied} />}
          <form action={cookLinkAction} className="mt-3">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="on" value={meals.flat.cookToken ? '0' : '1'} />
            <button className={meals.flat.cookToken ? secondary : primary}>{meals.flat.cookToken ? m.cookOff : m.cookOn}</button>
          </form>
        </Fold>
      </main>
      <Nav t={t} lang={lang} current="manage" showFlat />
    </>
  );
}
