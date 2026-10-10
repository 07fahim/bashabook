import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { listGone, listMembers } from '@/lib/auth';
import { closeInfo, openFrom } from '@/lib/close';
import { db } from '@/lib/db';
import { currentOffer, flatMoney, lastOutcome, pendingCount } from '@/lib/handover';
import { addDays, countChanges, headcount, indexChanges, isDate, isLocked, isPresent, mealCount, MEALS, nowDhaka, todayDhaka } from '@/lib/meals';
import { countAtLock, loadMeals, loadNoCookDays } from '@/lib/meals-db';
import { listRepeats, loadMonth, monthOf, toConfirm } from '@/lib/money-db';
import { requireManager } from '@/lib/session';
import { ActionForm } from '../action-form';
import { addMemberAction, addRoomAction, adminSetAction, cancelHandoverAction, cookLinkAction, offerHandoverAction, entryAction, noCookAction, noCookCancelAction, bringBackAction, leavingAction, removePhotoAction, renameAction, rentAction, resetPinAction, setRoomAction, settingsAction, stopRepeatAction } from '../actions';
import { Avatar } from '../avatar';
import { CloseCard } from '../close-card';
import { getDictionary, hasLocale } from '../dictionaries';
import { countText, fmtDay, fmtTaka, fmtTaka2, fmtTime } from '../format';
import { DateField } from '../date-field';
import { FocusHere } from '../focus-here';
import { Header } from '../header';
import { LockChange } from '../lock-change';
import { ConfirmList } from '../money/bits';
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
  const from = await openFrom(db, me.flatId, today), to = addDays(today, 60);
  // the person and day picked in "Change someone's meals"
  const who = typeof sp.who === 'string' ? sp.who : me.memberId;
  const day = typeof sp.day === 'string' && isDate(sp.day) && sp.day >= from && sp.day <= to ? sp.day : today;
  const [members, gone, meals, picked, noCookDays, mo, waiting, repeats, closing, offer, pending, money, outcome] = await Promise.all([
    listMembers(db, me.flatId),
    listGone(db, me.flatId, from),
    loadMeals(db, me.flatId, today, tomorrow),
    loadMeals(db, me.flatId, day, day),
    loadNoCookDays(db, me.flatId, today),
    loadMonth(db, me.flatId, monthOf(today), today),
    toConfirm(db, me.flatId, me.memberId, true),
    listRepeats(db, me.flatId),
    closeInfo(db, me.flatId, today),
    currentOffer(db, me.flatId),
    pendingCount(db, me.flatId),
    flatMoney(db, me.flatId, today),
    lastOutcome(db, me.flatId, me.memberId),
  ]);
  const t = getDictionary(lang), a = t.app, m = t.meals, mn = t.money;
  const tom = headcount(meals.members, meals.changes, tomorrow);
  const tod = headcount(meals.members, meals.changes, today);
  const line = (hc: typeof tom) => MEALS.map(x => `${m.names[x]} ${hc[x]}`).join(' · ');
  const card = 'mt-3 rounded-3xl border border-line bg-surface p-5';
  const own = new Set(meals.members.filter(x => !x.inMeals).map(x => x.id));
  const firstOpen = isLocked(tomorrow, nowDhaka(), meals.flat.cutoff) ? addDays(tomorrow, 1) : tomorrow;
  // tomorrow can still change until the lock time (and late after it), so the count and the shared text say so
  const status = firstOpen === tomorrow ? m.finalAt.replace('{t}', fmtTime(meals.flat.cutoff)) : m.final;
  // only after the lock does a change matter: before it, the card already says the count can still move
  const changes = firstOpen === tomorrow ? [] : countChanges(await countAtLock(db, me.flatId, tomorrow, tom, nowDhaka()), tom);
  const text = countText(me.flatName, m, tomorrow, tom, status, lang);
  const person = picked.members.find(x => x.id === who) ?? picked.members.find(x => x.id === me.memberId)!;
  const idx = indexChanges(picked.changes);
  // tells two people with one name apart: the one leaving and the one moving in
  const note = (x: { joinedOn: string; leftOn: string | null }) =>
    x.leftOn ? ` · ${a.lastDayBadge.replace('{d}', fmtDay(x.leftOn, lang))}` : x.joinedOn > today ? ` · ${a.movingInBadge.replace('{d}', fmtDay(x.joinedOn, lang))}` : '';
  const step = `grid size-11 place-items-center rounded-full border border-muted text-xl font-bold disabled:opacity-40 ${focus}`;

  return (
    <>
      <Header t={t} lang={lang} path="/manage"><Nav t={t} lang={lang} current="manage" showFlat /></Header>
      <main className="mx-auto max-w-md px-5 pt-6 pb-28 md:max-w-7xl md:px-8 md:pt-10 md:pb-16">
        <h1 className="font-display text-3xl font-bold">{me.flatName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-muted">
          <span>{m.lockTime.replace('{t}', fmtTime(meals.flat.cutoff))}</span> <Link href={`/${lang}/manage?rules=1#rules`} className={`inline-flex min-h-11 items-center ${link}`}>{m.changeTime}</Link>
        </p>

        {/* three groups of about the same height side by side; everyone in the flat (8 to 10 people) gets the full width
            below, so no column grows far past the others and leaves a hole */}
        <div className="md:grid md:grid-cols-2 md:items-start md:gap-x-8 lg:grid-cols-3">
          <div>
            <h2 className={groupLabel}>{m.groupToday}</h2>
            <section className={card}>
              <h3 className="text-xl font-bold">{m.headcountTitle}</h3>
              {/* tomorrow can still change until the lock time, so say whether the count is final */}
              <p className="mt-1 text-muted">{m.tomorrow} · {fmtDay(tomorrow, lang)} · {status}</p>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {MEALS.map(x => (
                  <div key={x} className="rounded-xl bg-paper py-3">
                    <dt className="text-[15px] text-muted">{m.names[x]}</dt>
                    <dd className="text-4xl font-bold tabular-nums">{tom[x]}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[15px] text-muted">{m.today}: {line(tod)}</p>
              <LockChange m={m} lang={lang} date={tomorrow} hc={tom} changes={changes} />
              <ShareButton text={text} label={m.share} copied={m.copied} />
            </section>
          </div>
          <div>
            <h2 className={groupLabel}>{mn.groupMoney}</h2>
            {closing && <div className="mt-3"><CloseCard lang={lang} x={mn} c={closing} collector={me.name} /></div>}
            <div className="mt-3">
              {waiting.length ? <ConfirmList lang={lang} a={t.app} x={mn} items={waiting} collector={me.name} /> : <p className="text-muted">{mn.noPending}</p>}
            </div>
            {([['payout', mn.giveTitle, mn.giveLead, mn.to], ['deposit', mn.gotTitle, mn.gotLead, mn.from]] as const).map(([type, title, lead, label]) => (
              <Fold key={type} title={title} lead={lead} level={3}>
                <ActionForm action={entryAction} className="mt-4">
                  <input type="hidden" name="lang" value={lang} />
                  <input type="hidden" name="type" value={type} />
                  <input type="hidden" name="key" value={randomUUID()} />
                  <label className="block font-semibold">
                    {label}
                    <select name="who" className={field} required defaultValue="">
                      <option value="" disabled>—</option>
                      {/* everyone living here, plus anyone who moved out still carrying a balance in, so they can be settled with */}
                      {mo.result.perMember.filter(p => p.opening !== 0 || mo.members.some(m => m.id === p.id)).map(p => <option key={p.id} value={p.id}>{mo.all.find(a => a.id === p.id)?.name}</option>)}
                    </select>
                  </label>
                  <Field label={mn.amount} name="amount" inputMode="decimal" required placeholder="3000" />
                  <DateField lang={lang} label={mn.date} name="date" required min={monthOf(today)} max={today} defaultValue={today} />
                  <Field label={mn.note} name="note" maxLength={100} />
                  <button className={primary}>{mn.save}</button>
                </ActionForm>
              </Fold>
            ))}
            <Fold title={mn.handTitle} lead={mn.handLead} level={3} open={!!offer}>
              {offer ? (
                <div className="mt-4">
                  <p className="font-semibold">{mn.handWaiting.replace('{name}', offer.to).replace('{t}', fmtTaka2(offer.amount))}</p>
                  <form action={cancelHandoverAction} className="mt-3">
                    <input type="hidden" name="lang" value={lang} />
                    <input type="hidden" name="id" value={offer.id} />
                    <button className={`${secondary} sm:w-auto`}>{mn.handCancel}</button>
                  </form>
                </div>
              ) : pending > 0 ? (
                <p className="mt-4">{pending === 1 ? mn.handBlockedOne : mn.handBlocked.replace('{n}', String(pending))}</p>
              ) : money < 0 ? (
                <p className="mt-4">{mn.handNegative}</p>
              ) : (
                <ActionForm action={offerHandoverAction} className="mt-4 space-y-3">
                  {/* a plain cancel by me says nothing; a decline or a cancel by a change says why */}
                  {outcome && (outcome.status === 'declined' || outcome.stale) && (
                    <p className="font-semibold">{(outcome.status === 'declined' ? mn.handDeclined : mn.handStale).replace('{name}', outcome.to)}</p>
                  )}
                  <input type="hidden" name="lang" value={lang} />
                  <input type="hidden" name="shown" value={money} />
                  <label className="block font-semibold">{mn.handTo}
                    <select name="to" className={field} required defaultValue="">
                      <option value="" disabled>—</option>
                      {members.filter(p => p.id !== me.memberId && !p.leftOn && p.joinedOn <= today).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <details>
                    <summary className={`${secondary} cursor-pointer list-none sm:inline-flex sm:w-auto [&::-webkit-details-marker]:hidden`}>{mn.handBtn} · {fmtTaka2(money)}</summary>
                    <button className={`${primary} mt-3 sm:w-auto`}>{mn.handYes}</button>
                  </details>
                </ActionForm>
              )}
            </Fold>
            <Fold title={mn.roomsTitle} lead={mn.roomsLead} level={3}>
              {mo.rooms.length > 0 && (
                <ul className="mt-4 divide-y divide-line">
                  {mo.rooms.map(room => (
                    <li key={room.id} className="py-3">
                      <form action={rentAction} className="flex flex-wrap items-end gap-3">
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="roomId" value={room.id} />
                        <span className="min-w-24 flex-1 self-center font-semibold">{room.name}</span>
                        <label className="text-[15px] font-semibold">{mn.rent}
                          <input name="rent" inputMode="decimal" defaultValue={room.rentShare / 100} className={`${field} w-32`} />
                        </label>
                        <button className={`${secondary} w-auto`}>{mn.save}</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <ActionForm action={addRoomAction} className="mt-4">
                <input type="hidden" name="lang" value={lang} />
                <Field label={mn.roomName} name="name" required maxLength={40} />
                <Field label={mn.rent} name="rent" inputMode="decimal" required placeholder="12000" />
                <button className={secondary}>{mn.addRoom}</button>
              </ActionForm>
              {mo.rooms.length > 0 && (
                <ul className="mt-6 divide-y divide-line">
                  {mo.members.map(p => (
                    <li key={p.id} className="py-2">
                      <form action={setRoomAction} className="flex flex-wrap items-center gap-3">
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="memberId" value={p.id} />
                        <span className="min-w-24 flex-1">{p.name}</span>
                        <select name="roomId" defaultValue={p.roomId ?? ''} aria-label={`${p.name}: ${mn.roomName}`} className={`${field} mt-0 w-40`}>
                          <option value="">{mn.noRoom}</option>
                          {mo.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
                        </select>
                        <button className={`${secondary} w-auto`}>{mn.save}</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Fold>
            <Fold title={mn.repeatsTitle} lead={mn.repeatsLead} level={3}>
              {!repeats.length ? <p className="mt-4 text-muted">{mn.noRepeats}</p> : (
                <ul className="mt-4 divide-y divide-line">
                  {repeats.map(rp => (
                    <li key={rp.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span>{rp.name} · {fmtTaka(rp.amount)} · {mn.splits[rp.split]}</span>
                      <form action={stopRepeatAction}>
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="id" value={rp.id} />
                        <button className={`min-h-11 px-2 ${link}`}>{mn.stopRepeat}</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </Fold>
          </div>
          {/* on a tablet this group takes the whole second row, its two halves side by side */}
          <div className="md:col-span-2 md:grid md:grid-cols-2 md:gap-x-8 lg:col-span-1 lg:block">
            <div>
            <h2 className={groupLabel}>{m.groupChange}</h2>
            <Fold title={m.editTitle} lead={m.editLead} level={3} open={'who' in sp}>
              <form className="mt-4 space-y-4">
                <label className="block font-semibold">
                  {m.who}
                  <select name="who" defaultValue={person.id} className={field}>
                    {/* someone who moved out recently is here too: their last days can still need fixing */}
                    {picked.members.filter(x => !x.leftOn || x.leftOn >= from).map(x => <option key={x.id} value={x.id}>{x.name}{note(x)}</option>)}
                  </select>
                </label>
                <DateField lang={lang} label={m.day} name="day" required min={from} max={to} defaultValue={day} />
                <button className={secondary}>{m.show}</button>
              </form>
              <p className="mt-5 font-semibold">{person.name} · {fmtDay(day, lang)}</p>
              {!isPresent(person, day) ? (
                <p className="mt-2 text-muted">{m.notInFlat}</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {MEALS.map(meal => {
                    // own meal and guests are two separate controls, so one never changes the other
                    const g = picked.changes.find(c => c.memberId === person.id && c.date === day && c.meal === meal)?.guests ?? 0;
                    const own = mealCount(person, idx, day, meal) - g;
                    const hidden = (<>
                      <input type="hidden" name="lang" value={lang} />
                      <input type="hidden" name="memberId" value={person.id} />
                      <input type="hidden" name="date" value={day} />
                      <input type="hidden" name="meal" value={meal} />
                    </>);
                    return (
                      <li key={meal} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <span className="font-semibold">{m.names[meal]}</span>
                        <form action={adminSetAction}>
                          {hidden}
                          <input type="hidden" name="guests" value={g} />
                          <button name="own" value={own ? 0 : 1} aria-pressed={own > 0} aria-label={`${m.names[meal]}, ${m.ownLabel}`}
                            className={`min-h-11 rounded-full px-4 font-semibold ${own ? 'bg-turmeric text-on-turmeric' : 'border border-muted'} ${focus}`}>
                            {own ? m.onOther : m.offOther}
                          </button>
                        </form>
                        <form action={adminSetAction} className="flex items-center gap-2">
                          {hidden}
                          <input type="hidden" name="own" value={own} />
                          <span className="text-[15px] text-muted">{m.guestsLabel}</span>
                          <button name="guests" value={g - 1} disabled={g === 0} aria-label={`${m.names[meal]}, ${m.guestsLabel}: ${m.less}`} className={step}>−</button>
                          <span className="w-6 text-center tabular-nums">{g}</span>
                          <button name="guests" value={g + 1} disabled={g >= 9} aria-label={`${m.names[meal]}, ${m.guestsLabel}: ${m.more}`} className={step}>+</button>
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
                <DateField lang={lang} label={m.from} name="from" required min={from} max={to} defaultValue={tomorrow} hint={m.noCookPast} />
                <DateField lang={lang} label={m.to} name="to" required min={from} max={to} defaultValue={tomorrow} />
                <fieldset>
                  <legend className="font-semibold">{m.whichMeals}</legend>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {MEALS.map(x => (
                      <label key={x} className={checkChip}>
                        <input type="checkbox" name={x} defaultChecked className="size-5 shrink-0 accent-on-turmeric" />
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
            <h2 className={groupLabel}>{m.groupSettings}</h2>
            <Fold id="rules" title={m.rulesTitle} level={3} open={'rules' in sp}>
              {'rules' in sp && <FocusHere />}
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
                {meals.flat.cookToken && <p className="mt-2 text-[15px] text-muted">{m.cookOffLead}</p>}
              </form>
            </Fold>
            </div>
          </div>
        </div>
        <div>
          <h2 className={groupLabel}>{a.members}</h2>
            <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2 md:items-start lg:grid-cols-3">
              {members.map(x => (
                <li key={x.id} className="rounded-3xl border border-line bg-surface p-5">
                  {/* a long badge (last day) drops below the name on a phone instead of squeezing it */}
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <span className="flex items-center gap-3 text-lg font-semibold"><Avatar id={x.id} name={x.name} v={x.photoV} size={36} />{x.name}</span>
                    <span className={`text-[15px] ${x.locked ? 'font-semibold text-chili' : 'text-muted'}`}>
                      {x.leftOn ? a.lastDayBadge.replace('{d}', fmtDay(x.leftOn, lang)) : x.joinedOn > today ? a.movingInBadge.replace('{d}', fmtDay(x.joinedOn, lang)) : !x.claimed ? a.notJoined : x.locked ? a.lockedBadge : x.failed > 0 ? `${x.failed} ${a.failed}` : own.has(x.id) ? m.ownBadge : ''}
                    </span>
                  </div>
                  {sp.back === x.id && <p role="status" className="mt-1 font-semibold text-leaf">{a.broughtBack}</p>}
                  {x.phone && <a href={`tel:${x.phone}`} aria-label={`${a.call} ${x.name}`} className={`inline-flex min-h-11 items-center text-[15px] tabular-nums ${link}`}>{x.phone}</a>}
                  {/* the member's actions sit on one line; an opened one takes the full width below */}
                  <div className="flex flex-wrap items-start gap-x-6">
                    <details className="open:basis-full">
                      <summary className={`inline-flex min-h-11 cursor-pointer items-center text-[15px] ${link}`}>{a.rename}</summary>
                      <ActionForm action={renameAction} className="mt-2">
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="memberId" value={x.id} />
                        <div className="flex gap-2">
                          <input name="name" required maxLength={40} autoComplete="off" defaultValue={x.name} aria-label={`${a.memberName}: ${x.name}`} className={`${field} mt-0 min-w-0 flex-1`} />
                          {/* its own classes: the shared button style is full width */}
                          <button className={`inline-flex min-h-12 shrink-0 items-center rounded-full border border-muted bg-surface px-5 font-semibold hover:bg-paper ${focus}`}>{a.save}</button>
                        </div>
                      </ActionForm>
                    </details>
                    {x.photoV !== null && (
                      <form action={removePhotoAction}>
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="memberId" value={x.id} />
                        <button className={`inline-flex min-h-11 items-center text-[15px] ${link}`}>{a.removePhoto}</button>
                      </form>
                    )}
                    {x.claimed && x.id !== me.memberId && (
                      <details className="open:basis-full">
                        <summary className={`inline-flex min-h-11 cursor-pointer items-center text-[15px] ${link}`}>{a.resetPin}</summary>
                        <p className="mt-2 text-[15px] text-muted">{a.resetLead}</p>
                        <ActionForm action={resetPinAction} className="mt-3">
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="memberId" value={x.id} />
                          <PinField label={a.oneTimePin} name="pin" autoComplete="off" />
                          <button className={`${secondary} sm:w-auto`}>{a.resetBtn}</button>
                        </ActionForm>
                      </details>
                    )}
                    {x.id !== me.memberId && (
                      <details className="open:basis-full">
                        <summary aria-label={`${a.movingOut}: ${x.name}`} className={`inline-flex min-h-11 cursor-pointer items-center text-[15px] ${link}`}>{a.movingOut}</summary>
                        <p className="mt-2 text-[15px] text-muted">{a.movingOutLead}</p>
                        <ActionForm action={leavingAction} className="mt-3">
                          <input type="hidden" name="lang" value={lang} />
                          <input type="hidden" name="memberId" value={x.id} />
                          {/* no default day, so one slip of a tap can't mark someone as leaving */}
                          <DateField lang={lang} label={a.lastDay} name="lastDay" required min={x.joinedOn > today ? x.joinedOn : today} max={to} defaultValue={x.leftOn ?? undefined} />
                          <button className={`${secondary} sm:w-auto`}>{a.movingOutBtn}</button>
                        </ActionForm>
                        {x.leftOn && (
                          <ActionForm action={leavingAction} className="mt-2">
                            <input type="hidden" name="lang" value={lang} />
                            <input type="hidden" name="memberId" value={x.id} />
                            <input type="hidden" name="stay" value="1" />
                            <button className={`inline-flex min-h-11 items-center text-[15px] ${link}`}>{a.staying}</button>
                          </ActionForm>
                        )}
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          <div className="md:grid md:grid-cols-2 md:items-start md:gap-x-8 lg:grid-cols-3">
          {gone.length > 0 && (
            <Fold title={a.movedOut} level={3}>
              <ul className="mt-2 divide-y divide-line">
                {gone.map(x => (
                  <li key={x.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <span className="font-semibold">{x.name}</span>
                      <span className="text-[15px] text-muted">{a.lastDayBadge.replace('{d}', fmtDay(x.leftOn, lang))}</span>
                    </div>
                    <details>
                      <summary aria-label={`${a.byMistake} ${x.name}`} className={`inline-flex min-h-11 cursor-pointer items-center text-[15px] ${link}`}>{a.byMistake}</summary>
                      <p className="mt-2 text-[15px] text-muted">{a.bringBackLead.replace('{d}', fmtDay(addDays(x.leftOn, 1), lang))}</p>
                      <ActionForm action={bringBackAction} className="mt-3">
                        <input type="hidden" name="lang" value={lang} />
                        <input type="hidden" name="memberId" value={x.id} />
                        <button aria-label={`${a.bringBackBtn}: ${x.name}`} className={`${secondary} sm:w-auto`}>{a.bringBackBtn}</button>
                      </ActionForm>
                    </details>
                  </li>
                ))}
              </ul>
            </Fold>
          )}
          <Fold title={a.addMember} level={3}>
            <ActionForm action={addMemberAction} className="mt-3">
              <input type="hidden" name="lang" value={lang} />
              <Field label={a.memberName} name="name" required maxLength={40} autoComplete="off" />
              <DateField lang={lang} label={m.joinedOn} name="joinedOn" required min={today} max={to} defaultValue={firstOpen} />
              <button className={primary}>{a.addBtn}</button>
            </ActionForm>
          </Fold>
          </div>
          </div>
      </main>
    </>
  );
}
