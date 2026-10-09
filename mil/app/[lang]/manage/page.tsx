import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { listMembers } from '@/lib/auth';
import { db } from '@/lib/db';
import { addDays, editFrom, headcount, indexChanges, isDate, isLocked, isPresent, mealCount, MEALS, nowDhaka, todayDhaka } from '@/lib/meals';
import { loadMeals, loadNoCookDays } from '@/lib/meals-db';
import { requireManager } from '@/lib/session';
import { ActionForm } from '../action-form';
import { addMemberAction, adminSetAction, cookLinkAction, noCookAction, noCookCancelAction, resetPinAction, settingsAction } from '../actions';
import { getDictionary, hasLocale } from '../dictionaries';
import { fmtDay } from '../format';
import { Header } from '../header';
import { Nav } from '../nav';
import { ShareButton } from '../share-button';
import { checkChip, field, Field, Fold, focus, groupLabel, link, PinField, primary, secondary, PageSkeleton } from '../ui';

type Props = PageProps<'/[lang]/manage'>;

export default function Manage({ params, searchParams }: Props) {
  return <Suspense fallback={<PageSkeleton />}><ManageBody params={params} searchParams={searchParams} /></Suspense>;
}

async function ManageBody({ params, searchParams }: Pick<Props, 'params' | 'searchParams'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const me = await requireManager(lang);
  const sp = await searchParams;
  const today = todayDhaka(), tomorrow = addDays(today, 1);
  const from = editFrom(today), to = addDays(today, 60);
  // the person and day picked in "Change someone's meals"
  const who = typeof sp.who === 'string' ? sp.who : me.memberId;
  const day = typeof sp.day === 'string' && isDate(sp.day) && sp.day >= from && sp.day <= to ? sp.day : today;
  const [members, meals, picked, noCookDays] = await Promise.all([
    listMembers(db, me.flatId),
    loadMeals(db, me.flatId, today, tomorrow),
    loadMeals(db, me.flatId, day, day),
    loadNoCookDays(db, me.flatId, today),
  ]);
  const t = getDictionary(lang), a = t.app, m = t.meals;
  const tom = headcount(meals.members, meals.changes, tomorrow);
  const tod = headcount(meals.members, meals.changes, today);
  const line = (hc: typeof tom) => MEALS.map(x => `${m.names[x]} ${hc[x]}`).join(' · ');
  const text = `${me.flatName} · ${m.tomorrow}, ${fmtDay(tomorrow, lang)}\n${line(tom)}`;
  const card = 'mt-3 rounded-2xl border border-line bg-surface p-5';
  const own = new Set(meals.members.filter(x => !x.inMeals).map(x => x.id));
  const firstOpen = isLocked(tomorrow, nowDhaka(), meals.flat.cutoff) ? addDays(tomorrow, 1) : tomorrow;
  const person = picked.members.find(x => x.id === who) ?? picked.members.find(x => x.id === me.memberId)!;
  const idx = indexChanges(picked.changes);
  const step = `grid size-11 place-items-center rounded-full border border-muted text-xl font-bold disabled:opacity-40 ${focus}`;

  return (
    <>
      <Header t={t} lang={lang} path="/manage" />
      <Nav t={t} lang={lang} current="manage" showFlat />
      <main className="mx-auto max-w-md px-5 pb-28 md:max-w-5xl md:pb-16">
        <h1 className="font-display text-3xl font-bold">{me.flatName}</h1>

        <div className="md:grid md:grid-cols-2 md:items-start md:gap-10">
          <div>
            <h2 className={groupLabel}>{m.groupToday}</h2>
            <section className={card}>
              <h3 className="text-xl font-bold">{m.headcountTitle}</h3>
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

            <h2 className={groupLabel}>{m.groupChange}</h2>
            <Fold title={m.editTitle} lead={m.editLead} level={3} open={'who' in sp}>
              <form className="mt-4 space-y-4">
                <label className="block font-semibold">
                  {m.who}
                  <select name="who" defaultValue={person.id} className={field}>
                    {members.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                <Field label={m.day} name="day" type="date" required min={from} max={to} defaultValue={day} />
                <button className={secondary}>{m.show}</button>
              </form>
              <p className="mt-5 font-semibold">{person.name} · {fmtDay(day, lang)}</p>
              {!isPresent(person, day) ? (
                <p className="mt-2 text-muted">{m.notInFlat}</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {MEALS.map(meal => {
                    const n = mealCount(person, idx, day, meal);
                    return (
                      <li key={meal} className="flex items-center justify-between gap-3 py-3">
                        <span className="font-semibold">{m.names[meal]}</span>
                        <form action={adminSetAction} className="flex items-center gap-3">
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="memberId" value={person.id} />
                          <input type="hidden" name="date" value={day} />
                          <input type="hidden" name="meal" value={meal} />
                          <button name="count" value={n - 1} disabled={n === 0} aria-label={`${m.names[meal]}: ${m.less}`} className={step}>−</button>
                          <span className="w-20 text-center tabular-nums">{n > 1 ? `${n} ${m.platesShort}` : n ? m.on : m.off}</span>
                          <button name="count" value={n + 1} disabled={n >= 10} aria-label={`${m.names[meal]}: ${m.more}`} className={step}>+</button>
                        </form>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Fold>

            <Fold title={m.noCookTitle} lead={m.noCookLead} level={3}>
              {noCookDays.length > 0 && (
                <div className="mt-4">
                  <p className="font-semibold">{m.noCookDays}</p>
                  <ul className="mt-2 divide-y divide-line">
                    {noCookDays.map(n => (
                      <li key={n.date} className="flex items-center justify-between gap-3 py-2">
                        <span>{fmtDay(n.date, lang)} · {n.meals.split(',').map(x => m.names[x as 'b']).join(', ')}</span>
                        <form action={noCookCancelAction}>
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="date" value={n.date} />
                          <input type="hidden" name="meals" value={n.meals} />
                          <button className={`min-h-11 px-4 font-semibold ${link}`}>{m.cancel}</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
              </ActionForm>
            </Fold>
          </div>
          <div>
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
                        <summary className={`inline-block cursor-pointer py-2 text-[15px] ${link}`}>{a.resetPin}</summary>
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
            </section>
            <Fold title={a.addMember} level={3}>
              <ActionForm action={addMemberAction} className="mt-3">
                <input type="hidden" name="lang" value={lang} />
                <Field label={a.memberName} name="name" required maxLength={40} autoComplete="off" />
                <Field label={m.joinedOn} name="joinedOn" type="date" required min={today} max={to} defaultValue={firstOpen} />
                <button className={primary}>{a.addBtn}</button>
              </ActionForm>
            </Fold>

            <h2 className={groupLabel}>{m.groupSettings}</h2>
            <Fold title={m.rulesTitle} level={3}>
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
                <button className={primary}>{m.save}</button>
              </ActionForm>
            </Fold>
            <Fold title={m.cookTitle} lead={m.cookLead} level={3}>
              {meals.flat.cookToken && <ShareButton path={`/${meals.flat.lang}/c/${meals.flat.cookToken}`} label={m.share} copied={m.copied} />}
              <form action={cookLinkAction} className="mt-3">
                <input type="hidden" name="lang" value={lang} />
                <input type="hidden" name="on" value={meals.flat.cookToken ? '0' : '1'} />
                <button className={meals.flat.cookToken ? secondary : primary}>{meals.flat.cookToken ? m.cookOff : m.cookOn}</button>
              </form>
            </Fold>
          </div>
        </div>
      </main>
    </>
  );
}
