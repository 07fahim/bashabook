'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { addMember, changePin, cleanName, UUID, createFlat, isPin, login, normalizePhone, renameMember, resetPin, setLeaving, setPhone, bringBack, listMembers } from '@/lib/auth';
import { addCorrection, CASH_KEYS, closeMonth, coverGap, openFrom, openStart, parseCash, type Correction } from '@/lib/close';
import { db } from '@/lib/db';
import { acceptHandover, cancelHandover, declineHandover, offerHandover, pendingCount } from '@/lib/handover';
import { addDays, headcount, isDate, isLocked, isMeal, isPresent, MEALS, nowDhaka, todayDhaka } from '@/lib/meals';
import {
  addGuests, cancelAway, cookAgain, isInMeals, loadMeals, mealRules, noCooking, removeGuests, saveMeal, seedLock, setAway, setDefaults, setOtherMeal, setOwn, toldCook, updateSettings,
} from '@/lib/meals-db';
import { toPoisha } from '@/lib/money';
import { addEntry, addRoom, confirmEntry, endedOpenMonth, monthOf, putBack, removeEntry, setRent, setRoom, stopRepeat } from '@/lib/money-db';
import { fromDataUrl, removePhoto, setPhoto } from '@/lib/photo';
import { currentToken, endSession, requireManager, requireMember, startSession } from '@/lib/session';
import type { FormState } from './action-form';
import { getDictionary, hasLocale, type Locale } from './dictionaries';
import { fmtDay, fmtExact, fmtMonth, fmtSigned } from './format';

const str = (d: FormData, k: string) => String(d.get(k) ?? '');
const langOf = (d: FormData): Locale => { const l = str(d, 'lang'); return hasLocale(l) ? l : 'bn'; };

export async function createFlatAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), e = getDictionary(lang).app.errors;
  const flatName = cleanName(d.get('flatName')), name = cleanName(d.get('name'));
  const others = str(d, 'others').split('\n').map(s => s.trim()).filter(Boolean).map(cleanName);
  if (!flatName || !name || others.includes(null) || others.length > 30) return { error: e.name };
  if (!isPin(d.get('pin'))) return { error: e.pin };
  if (str(d, 'pin') !== str(d, 'pin2')) return { error: e.pinMatch };
  const { memberId } = await createFlat(db, { flatName, name, pin: str(d, 'pin'), others: others as string[], today: todayDhaka(), lang });
  await startSession(memberId);
  redirect(`/${lang}/home`);
}

export async function joinByCodeAction(d: FormData) {
  redirect(`/${langOf(d)}/j/${encodeURIComponent(str(d, 'code').replace(/\s/g, '').toUpperCase())}`);
}

export async function loginAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), e = getDictionary(lang).app.errors;
  const pin = str(d, 'pin'), newPin = d.has('newPin') ? str(d, 'newPin') : null;
  if (!isPin(pin) || (newPin !== null && !isPin(newPin))) return { error: e.pin };
  if (d.has('pin2') && (newPin ?? pin) !== str(d, 'pin2')) return { error: e.pinMatch };
  const r = await login(db, str(d, 'code'), str(d, 'memberId'), pin, newPin);
  if ('error' in r) return { error: e[r.error] };
  await startSession(r.memberId);
  redirect(`/${lang}/home`);
}

export async function logoutAction(d: FormData) {
  await endSession();
  redirect(`/${langOf(d)}`);
}

export async function addMemberAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), a = getDictionary(lang).app;
  const me = await requireManager(lang);
  // before any change: keep tomorrow's count as it was at the lock, so the cards can say what moved
  await seedLock(db, me.flatId, nowDhaka());
  const name = cleanName(d.get('name')), joinedOn = str(d, 'joinedOn');
  if (!name) return { error: a.errors.name };
  if (!isDate(joinedOn) || joinedOn < todayDhaka() || !editable(joinedOn, await openFrom(db, me.flatId, todayDhaka()))) return { error: getDictionary(lang).meals.errors.bad };
  if (!(await addMember(db, me.flatId, name, joinedOn))) return { error: a.errors.nameTaken };
  refresh();
  return { done: a.added };
}

export async function resetPinAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), a = getDictionary(lang).app;
  const me = await requireManager(lang);
  if (!isPin(d.get('pin'))) return { error: a.errors.pin };
  if (!(await resetPin(db, me.flatId, str(d, 'memberId'), str(d, 'pin')))) return { error: a.errors.notFound };
  refresh();
  return { done: a.resetDone };
}

const plates = (v: string) => (/^\d{1,2}$/.test(v) && Number(v) <= 10 ? Number(v) : null);
/** Today up to 60 days ahead. */
const inRange = (date: string) => isDate(date) && date >= todayDhaka() && date <= addDays(todayDhaka(), 60);

/** A meal chip tap. The chip sends the count it wants; repeating the tap is harmless. */
export async function setMealAction(d: FormData) {
  const me = await requireMember(langOf(d));
  await seedLock(db, me.flatId, nowDhaka());
  // a chip switches only my own plate; my guests stay
  const date = str(d, 'date'), meal = str(d, 'meal'), own = str(d, 'own');
  if (inRange(date) && isMeal(meal) && (own === '0' || own === '1')) {
    await setOwn(db, me.flatId, me.memberId, date, meal, own === '1' ? 1 : 0, nowDhaka());
  }
  refresh();   // also redraws a page left open past midnight
}

/** Removes my guests from one later meal; my own plate stays. */
export async function removeGuestsAction(d: FormData) {
  const me = await requireMember(langOf(d));
  await seedLock(db, me.flatId, nowDhaka());
  const date = str(d, 'date'), meal = str(d, 'meal');
  if (inRange(date) && isMeal(meal)) await removeGuests(db, me.flatId, me.memberId, date, meal, nowDhaka());
  refresh();
}

export async function guestAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
  await seedLock(db, me.flatId, nowDhaka());
  // guests plus my own plate when I'm eating too
  const guests = /^\d$/.test(str(d, 'guests')) ? Number(str(d, 'guests')) : null;
  const date = str(d, 'date'), meal = str(d, 'meal'), now = nowDhaka();
  if (!inRange(date) || !isMeal(meal) || guests === null) return { error: m.errors.bad };
  // the member always comes from the session, so nobody can change someone else's guests
  const r = await addGuests(db, me.flatId, me.memberId, date, meal, guests, now);
  if (r === 'full') return { error: m.errors.tooManyGuests };
  if (r === 'closed') return { error: guests < 1 ? m.errors.todayAddOnly : m.errors.closed };
  refresh();
  return { done: m.saved };
}

export async function awayAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
  await seedLock(db, me.flatId, nowDhaka());
  const from = str(d, 'from'), to = str(d, 'to');
  if (!inRange(from) || !isDate(to) || to < from) return { error: m.errors.bad };
  if (to > addDays(from, 59)) return { error: m.errors.range };
  const first = addDays(await lastLocked(me.flatId), 1);
  if (from < first) return { error: m.errors.awayFrom.replace('{d}', fmtDay(first, lang)) };
  const dropped = await setAway(db, me.flatId, me.memberId, from, to);
  refresh();
  if (!dropped.length) return { done: m.saved };
  // same shape as the guest list; dates hold commas, so items are split by semicolons
  const list = dropped.map(g => `${fmtDay(g.date, lang)} · ${m.names[g.meal]} · ${g.guests === 1 ? m.guestOne : m.guestMany.replace('{n}', String(g.guests))}`).join('; ');
  return { done: m.awayGuestsDropped.replace('{list}', list) };
}

export async function usualAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
  await seedLock(db, me.flatId, nowDhaka());
  // all three off = cooking for yourself; any on = back in shared meals
  const usual = { b: d.has('b'), l: d.has('l'), d: d.has('d') };
  const inMeals = usual.b || usual.l || usual.d, was = await isInMeals(db, me.flatId, me.memberId);
  // every open month keeps the meals it had, however old: freeze from the oldest open month, not just the edit window
  const open = await openStart(db, me.flatId), locked = await lastLocked(me.flatId);
  const r = await unlessClosed(() => setDefaults(db, me.flatId, me.memberId, usual, open, locked, inMeals === was ? null : inMeals));
  if (r === 'closed') return { error: m.errors.closed };
  if (inMeals !== was) { refresh(); return { done: inMeals ? m.savedShared : m.savedOwn }; }
  refresh();
  return { done: m.saved };
}

export async function settingsAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireManager(lang);
  const cutoff = str(d, 'cutoff').slice(0, 5);
  const [b, l, dd] = MEALS.map(x => (/^(\d{1,2}(\.\d{1,2})?|\.\d{1,2})$/.test(str(d, `w_${x}`)) ? Math.round(Number(str(d, `w_${x}`)) * 100) : -1));
  const weightsOk = [b, l, dd].every(w => w >= 0 && w <= 1000) && b + l + dd > 0;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff) || !weightsOk) return { error: m.errors.bad };
  const now = nowDhaka(), tomorrow = addDays(now.slice(0, 10), 1), was = await mealRules(db, me.flatId);
  const set = await updateSettings(db, me.flatId, me.memberId, { cutoff, weights: { b, l, d: dd } }, now, d.get('fix') === '1');
  if (set === 'earlier') return await earlier(lang, me.flatId, now.slice(0, 10));
  refresh();
  // a lock time already past locks tomorrow from now: give the count to tell the cook (earlier changes were on time)
  if (isLocked(tomorrow, now, cutoff) && !isLocked(tomorrow, now, was.cutoff)) {
    const { members, changes } = await loadMeals(db, me.flatId, tomorrow, tomorrow);
    const hc = headcount(members, changes, tomorrow);
    return { done: m.lockedNow.replace('{list}', MEALS.map(x => `${m.names[x]} ${hc[x]}`).join(', ')) };
  }
  return { done: m.saved };
}

const editable = (date: string, from: string) => isDate(date) && date >= from && date <= addDays(todayDhaka(), 60);

export async function noCookAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireManager(lang);
  await seedLock(db, me.flatId, nowDhaka());
  const from = str(d, 'from'), to = str(d, 'to'), meals = MEALS.filter(x => d.has(x)), open = await openFrom(db, me.flatId, todayDhaka());
  if (!editable(from, open) || !editable(to, open) || to < from) return { error: m.errors.bad };
  if (to > addDays(from, 59)) return { error: m.errors.range };
  if (!meals.length) return { error: m.errors.pickMeal };
  const locked = await lastLocked(me.flatId);
  if (await unlessClosed(() => noCooking(db, me.flatId, me.memberId, from, to, meals, locked)) === 'closed') return { error: m.errors.closed };
  refresh();
  return { done: m.saved };
}

/** The last day members can no longer change: tomorrow once it's past the cutoff, else today. */
async function lastLocked(flatId: string) {
  const now = nowDhaka(), today = now.slice(0, 10), r = await mealRules(db, flatId);
  return isLocked(addDays(today, 1), now, r.cutoff) ? addDays(today, 1) : today;
}

/** Cancels my away from the first open day on; locked days stay as they were. */
export async function cancelAwayAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
  await seedLock(db, me.flatId, nowDhaka());
  const from = str(d, 'from'), to = str(d, 'to'), first = addDays(await lastLocked(me.flatId), 1);
  if (!isDate(from) || !isDate(to) || to < first) return { error: m.errors.bad };
  await cancelAway(db, me.flatId, me.memberId, from < first ? first : from, to);
  refresh();
  return { done: m.saved };
}

/** The flat's starter sets anyone's plates for a meal (− / +), today and past days included. Late once the day is locked. */
export async function adminSetAction(d: FormData) {
  const me = await requireManager(langOf(d));
  await seedLock(db, me.flatId, nowDhaka());
  // own plate and guests are set separately, so a guest change never touches someone's own meal and back
  const memberId = str(d, 'memberId'), date = str(d, 'date'), meal = str(d, 'meal'), own = str(d, 'own'), guests = plates(str(d, 'guests'));
  const member = (await loadMeals(db, me.flatId, date, date)).members.find(x => x.id === memberId);
  if (member && editable(date, await openFrom(db, me.flatId, todayDhaka())) && isPresent(member, date) && isMeal(meal) && (own === '0' || own === '1') && guests !== null && guests <= 9) {
    const r = await mealRules(db, me.flatId);
    await unlessClosed(() => saveMeal(db, me.flatId, me.memberId, { memberId, date, meal, count: Number(own) + guests, guests }, isLocked(date, nowDhaka(), r.cutoff)));
  }
  refresh();
}

/** Another flatmate's own plate, before the lock. The actor always comes from the session; every rule is checked again
 *  inside set_other_meal, so a forged form gets 'closed', never a write. */
export async function otherMealAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
  await seedLock(db, me.flatId, nowDhaka());
  const target = str(d, 'target'), date = str(d, 'date'), meal = str(d, 'meal'), own = str(d, 'own'), seen = str(d, 'seen');
  if (!UUID.test(target) || !isDate(date) || !isMeal(meal) || !/^[01]$/.test(own) || !/^[01]$/.test(seen)) return { error: m.errors.bad };
  const r = await setOtherMeal(db, me.flatId, me.memberId, target, date, meal, Number(own) as 0 | 1, Number(seen) as 0 | 1);
  if (r !== 'ok') refresh();   // the fold redraws with the current plate, so a retry doesn't send a stale seen again
  if (r === 'changed') return { error: m.otherChanged };
  if (r === 'closed') {
    const [c] = await db<{ name: string }>(`select name from members where flat_id = $1 and role = 'manager'`, [me.flatId]);
    return { error: m.otherClosed.replace('{name}', c?.name ?? '') };
  }
  refresh();
  return { done: m.saved };
}

/** The cook is back for one listed no-cooking day. */
export async function noCookCancelAction(d: FormData) {
  const me = await requireManager(langOf(d));
  await seedLock(db, me.flatId, nowDhaka());
  const date = str(d, 'date'), meals = str(d, 'meals').split(',').filter(isMeal);
  // today or later, as the screen offers: a past day was already cooked (or not), and un-blocking it would rewrite everyone's meals
  if (editable(date, await openFrom(db, me.flatId, todayDhaka())) && date >= todayDhaka() && meals.length) await unlessClosed(() => cookAgain(db, me.flatId, me.memberId, date, date, meals, date));
  refresh();
}

/** I told the cook the count on my screen: it becomes tomorrow's baseline, so the after-the-lock warning goes for everyone. */
export async function toldCookAction(d: FormData) {
  const me = await requireMember(langOf(d));
  const date = str(d, 'date');
  // only tomorrow's count: a page left open overnight posts a day nobody looks at any more
  if (date === addDays(todayDhaka(), 1) && MEALS.every(x => /^\d{1,3}$/.test(str(d, x)))) {
    await toldCook(db, me.flatId, me.memberId, date, { b: Number(str(d, 'b')), l: Number(str(d, 'l')), d: Number(str(d, 'd')) });
  }
  refresh();
}

/** I change my own PIN: current one, then the new one twice. My other phones are signed out. */
export async function changePinAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), a = getDictionary(lang).app;
  const me = await requireMember(lang);
  if (!isPin(d.get('pin')) || !isPin(d.get('newPin'))) return { error: a.errors.pin };
  if (str(d, 'newPin') !== str(d, 'pin2')) return { error: a.errors.pinMatch };
  const r = await changePin(db, me.memberId, str(d, 'pin'), str(d, 'newPin'), await currentToken());
  if (r !== 'ok') return { error: a.errors[r] };
  return { done: a.pinChanged };
}

/** My own mobile number; empty removes it. */
export async function phoneAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), a = getDictionary(lang).app;
  const me = await requireMember(lang);
  const raw = str(d, 'phone').trim(), phone = raw ? normalizePhone(raw) : null;
  if (raw && !phone) return { error: a.errors.phone };
  await setPhone(db, me.memberId, phone);
  refresh();
  return { done: a.saved };
}

/** The person who runs the flat fixes someone's name. */
export async function renameAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), a = getDictionary(lang).app;
  const me = await requireManager(lang);
  const name = cleanName(d.get('name'));
  if (!name) return { error: a.errors.name };
  const r = await renameMember(db, me.flatId, me.memberId, str(d, 'memberId'), name);
  if (r !== 'ok') return { error: r === 'taken' ? a.errors.nameTaken : a.errors.notFound };
  refresh();
  return { done: a.renamed };
}

/** My photo, already shrunk by the phone to a small JPEG and sent as a data URL. */
export async function photoAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), a = getDictionary(lang).app;
  const me = await requireMember(lang);
  const bytes = fromDataUrl(str(d, 'photo'));
  if (!bytes || !(await setPhoto(db, me.memberId, bytes))) return { error: a.errors.photo };
  refresh();
  return { done: a.photoSaved };
}

/** My own photo, or anyone's for the person who runs the flat. */
export async function removePhotoAction(d: FormData) {
  const me = await requireMember(langOf(d)), id = str(d, 'memberId');
  if (UUID.test(id)) await removePhoto(db, me, id);
  refresh();
}

/** The person who runs the flat sets someone's last day here, or takes it back. */
export async function leavingAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), a = getDictionary(lang).app;
  const me = await requireManager(lang);
  await seedLock(db, me.flatId, nowDhaka());
  const day = d.has('stay') ? null : str(d, 'lastDay');
  if (day !== null && !isDate(day)) return { error: a.errors.lastDay };
  const r = await setLeaving(db, me.flatId, me.memberId, str(d, 'memberId'), day, todayDhaka());
  if (r !== 'ok') return { error: r === 'taken' ? a.errors.sameNameNow : a.errors.lastDay };
  refresh();
  return { done: day ? a.lastDaySaved : a.stayingSaved };
}

/** Undoes a departure marked by mistake; the days in between stay as they were cooked. */
export async function bringBackAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), a = getDictionary(lang).app;
  const me = await requireManager(lang);
  await seedLock(db, me.flatId, nowDhaka());
  const today = todayDhaka(), id = str(d, 'memberId'), open = await openFrom(db, me.flatId, today);
  const r = await unlessClosed(() => bringBack(db, me.flatId, me.memberId, id, today, open));
  if (r === 'closed') return { error: a.errors.notFound };
  if (r === 'taken') return { error: a.errors.nameUsedSince };
  // a second phone pressing at the same moment finds them already back: that is the same good outcome, not an error
  if (r === 'no' && !(await listMembers(db, me.flatId)).some(x => x.id === id && !x.leftOn)) return { error: a.errors.notFound };
  // their Moved out row is gone after this, and its message with it, so the note shows under their name in the list
  redirect(`/${lang}/manage?back=${id}`);
}

const TYPES = ['bazar', 'bill', 'deposit', 'payout'] as const;
const SPLITS = ['here', 'equal', 'room', 'meals', 'selected'] as const;
const pick = <T extends string>(list: readonly T[], v: string) => (list as readonly string[]).includes(v) ? (v as T) : null;

/** A write into a closed month is refused by the database (month_closed); here it becomes a message, not a crash. */
async function unlessClosed<T>(f: () => Promise<T>): Promise<T | 'closed'> {
  try { return await f(); } catch (err) { if (String(err).includes('month_closed')) return 'closed'; throw err; }
}

/** Every money entry form. `who`: for bazar and bills who paid ('fund' = flat money); for deposits and payouts the other person. */
export async function entryAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), x = getDictionary(lang).money;
  const me = await requireMember(lang);
  const type = pick(TYPES, str(d, 'type')), amount = toPoisha(str(d, 'amount')), date = str(d, 'date'), today = todayDhaka();
  if (!type) return { error: x.errors.bad };
  if (amount === null) return { error: x.errors.amount };
  // which dates are allowed (flatmates: this month; the collector: any month still open) is checked in addEntry
  if (!isDate(date)) return { error: x.errors.date };
  const note = str(d, 'note').trim().slice(0, 100) || null, who = str(d, 'who');
  const split = type === 'bill' ? pick(SPLITS, str(d, 'split')) : null, selected = [...new Set(d.getAll('people').map(String))];
  if (type === 'bill' && !split) return { error: x.errors.bad };
  if (type === 'bill' && !note) return { error: x.errors.name };
  if (split === 'selected' && !selected.length) return { error: x.errors.people };
  const moving = type === 'deposit' || type === 'payout';
  const key = str(d, 'key');
  const r = await unlessClosed(() => addEntry(db, me.flatId, me, {
    id: UUID.test(key) ? key : undefined,
    type, amount, date, note, split, selected,
    paidBy: moving || who === 'fund' ? null : who,
    memberId: moving ? who || me.memberId : null,
    repeat: type === 'bill' && d.get('repeat') === '1',   // saved with the bill in one statement
  }, today));
  if (r !== 'ok') return { error: x.errors[r] };
  refresh();
  return { done: x.saved };
}

export async function confirmAction(d: FormData) {
  const me = await requireMember(langOf(d)), id = str(d, 'id');
  if (UUID.test(id)) await unlessClosed(() => confirmEntry(db, me.flatId, me, id));
  refresh();
}

export async function removeAction(d: FormData) {
  const me = await requireMember(langOf(d)), id = str(d, 'id');
  if (UUID.test(id)) await unlessClosed(() => removeEntry(db, me.flatId, me, id, todayDhaka()));
  refresh();
}

/** Rent typed in taka; 0 is allowed (a room that pays no rent). */
const rentOf = (v: string) => (v.trim() !== '' && Number(v.trim()) === 0 ? 0 : toPoisha(v));

export async function addRoomAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), x = getDictionary(lang).money;
  const me = await requireManager(lang);
  const name = cleanName(d.get('name')), rent = rentOf(str(d, 'rent'));
  if (!name) return { error: x.errors.roomName };
  if (rent === null) return { error: x.errors.amount };
  if (await addRoom(db, me.flatId, me, name, rent, guardOf(d)) === 'earlier') return await earlier(lang, me.flatId, todayDhaka());
  refresh();
  return { done: x.saved };
}

/** A room, rent or weight change while a month that has ended is still open: forms post fix=1 once the person ticks the box. */
const guardOf = (d: FormData) => ({ today: todayDhaka(), fix: d.get('fix') === '1' });
/** The refusal: close that month first, or tick that this deliberately fixes it. */
async function earlier(lang: Locale, flatId: string, today: string): Promise<FormState> {
  const x = getDictionary(lang).money, month = await endedOpenMonth(db, flatId, today) ?? monthOf(today);
  const fill = (t: string) => t.replaceAll('{month}', fmtMonth(month)).replaceAll('{next}', fmtMonth(monthOf(today)));
  return { error: fill(x.earlierBlock), confirm: fill(x.earlierFix) };
}

export async function rentAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), me = await requireManager(lang), id = str(d, 'roomId'), rent = rentOf(str(d, 'rent'));
  if (!UUID.test(id) || rent === null) return { error: getDictionary(lang).money.errors.amount };
  if (await setRent(db, me.flatId, me, id, rent, guardOf(d)) === 'earlier') return await earlier(lang, me.flatId, todayDhaka());
  refresh();
  return { done: getDictionary(lang).money.saved };
}

export async function setRoomAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), me = await requireManager(lang), memberId = str(d, 'memberId'), roomId = str(d, 'roomId');
  if (!UUID.test(memberId) || (roomId !== '' && !UUID.test(roomId))) return null;
  if (await setRoom(db, me.flatId, me, memberId, roomId || null, guardOf(d)) === 'earlier') return await earlier(lang, me.flatId, todayDhaka());
  refresh();
  return { done: getDictionary(lang).money.saved };
}

export async function stopRepeatAction(d: FormData) {
  const me = await requireManager(langOf(d)), id = str(d, 'id');
  if (UUID.test(id)) await stopRepeat(db, me.flatId, me, id);
  refresh();
}

export async function putBackAction(d: FormData) {
  const me = await requireMember(langOf(d)), id = str(d, 'id');
  if (UUID.test(id)) await unlessClosed(() => putBack(db, me.flatId, me.memberId, id, todayDhaka()));   // the rules live in putBack
  refresh();
}

/** The collector closes the oldest finished month: the four cash boxes must add up to the app's fund. */
export async function closeAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), x = getDictionary(lang).money;
  const me = await requireManager(lang);
  const month = str(d, 'month');
  if (!/^\d{4}-\d{2}-01$/.test(month) || !isDate(month)) return { error: x.errors.bad };
  const cash = parseCash(Object.fromEntries(CASH_KEYS.map(k => [k, str(d, k)])) as Record<(typeof CASH_KEYS)[number], string>);
  if (!cash) return { error: x.errors.cashBoxes };
  const r = await closeMonth(db, me.flatId, me, month, todayDhaka(), cash);
  if (r.result === 'cash') {
    return { error: (r.actual < r.expected ? x.errors.cashShort : x.errors.cashOver)
      .replace('{a}', fmtExact(r.actual)).replace('{b}', fmtSigned(r.expected)).replace('{d}', fmtExact(r.actual - r.expected)) };
  }
  if (r.result !== 'ok' && r.result !== 'closed') return { error: r.result === 'notCollector' ? x.errors.bad : x.errors[r.result] };
  redirect(`/${lang}/money?m=${month.slice(0, 7)}`);   // the closed month, with its settlement to share; 'closed' means a second tap already got it there
}

/** The collector paid more than flat money held: records their own deposit of the gap into the month to close (amount from the server). */
export async function coverGapAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), x = getDictionary(lang).money;
  const me = await requireManager(lang);
  // the one deliberate exception to entryAction's this-month-only dates: only this deposit, only into the month to close
  // `shown`: the amount the card showed, in poisha; only compared, never recorded
  const shown = Number(str(d, 'shown'));
  if (!Number.isSafeInteger(shown)) return { error: x.errors.bad };
  const r = await unlessClosed(() => coverGap(db, me.flatId, me, todayDhaka(), x.coverNote, shown));
  if (r === 'changed') { refresh(); return { error: x.errors.coverChanged }; }
  if (r !== 'ok') { refresh(); return { error: r === 'closed' ? x.errors.closed : x.errors.bad }; }   // a stale card redraws
  refresh();
  return { done: x.saved };
}

const KINDS = ['bazar', 'bill', 'move'] as const;
const FIX_SPLITS = ['meals', 'equal', 'selected'] as const;

/** A fix for a closed month, booked in this month (collector only; the rules live in addCorrection). */
export async function correctionAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), x = getDictionary(lang).money;
  const me = await requireManager(lang);
  const kind = pick(KINDS, str(d, 'kind')), amount = toPoisha(str(d, 'amount')), forMonth = str(d, 'forMonth'), key = str(d, 'key');
  const note = str(d, 'note').trim().slice(0, 100);
  // a bill split outside the list is a bad form, not a silent default
  const split = kind === 'bill' ? pick(FIX_SPLITS, str(d, 'split')) : null;
  if (!kind || !UUID.test(key) || !/^\d{4}-\d{2}-01$/.test(forMonth) || !isDate(forMonth) || (kind === 'bill' && !split)) return { error: x.errors.bad };
  if (amount === null) return { error: x.errors.amount };
  if (!note) return { error: x.errors.reason };
  const people = [...new Set(d.getAll('people').map(String))];
  const base = { id: key, forMonth, amount, note };
  const c: Correction = kind === 'move' ? { ...base, kind, from: str(d, 'from'), to: str(d, 'to') }
    : kind === 'bill' ? { ...base, kind, paidBy: str(d, 'who'), split: split!, selected: people }
    : { ...base, kind, paidBy: str(d, 'who') };
  const ids = kind === 'move' ? [str(d, 'from'), str(d, 'to')] : [str(d, 'who'), ...(split === 'selected' ? people : [])];
  if (kind === 'move' && ids[0] && ids[0] === ids[1]) return { error: x.errors.samePerson };
  if (!ids.every(id => UUID.test(id)) || (split === 'selected' && !people.length)) return { error: x.errors.people };
  const r = await addCorrection(db, me.flatId, me, c, todayDhaka());
  if (r !== 'ok') return { error: r === 'month' ? x.errors.month : x.errors.bad };
  refresh();
  return { done: x.saved };
}

/** The collector offers the flat money; the role moves only when the recipient accepts. */
export async function offerHandoverAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), x = getDictionary(lang).money;
  const me = await requireManager(lang);
  const to = str(d, 'to'), shown = Number(str(d, 'shown'));
  if (!UUID.test(to) || !Number.isSafeInteger(shown)) return { error: x.errors.people };
  const r = await offerHandover(db, me.flatId, me, to, shown, todayDhaka());
  refresh();
  if (r === 'ok') return { done: x.saved };
  if (r === 'waiting') {
    const n = await pendingCount(db, me.flatId);
    return { error: n > 1 ? x.handBlocked.replace('{n}', String(n)) : x.handBlockedOne };
  }
  const errors = { changed: x.errors.handChanged, already: x.errors.handAlready, recipient: x.errors.handRecipient,
    negative: x.handNegative, notCollector: x.errors.bad } as const;
  return { error: errors[r] };
}

export async function cancelHandoverAction(d: FormData) {
  const me = await requireManager(langOf(d)), id = str(d, 'id');
  if (UUID.test(id)) await cancelHandover(db, me.flatId, me.memberId, id);
  refresh();
}

/** `from` is the offerer's name, posted only for the message; never trusted for anything else. */
export async function acceptHandoverAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), x = getDictionary(lang).money;
  const me = await requireMember(lang);
  const id = str(d, 'id'), from = str(d, 'from');
  if (!UUID.test(id)) return { error: x.errors.bad };
  const r = await acceptHandover(db, me.flatId, me.memberId, id);
  refresh();
  if (r === 'ok') return { done: x.takeDone };
  if (r === 'changed' || r === 'cancelled') return { error: x.takeStale.replace('{name}', from) };
  if (r === 'declined') return { error: x.takeDeclined.replace('{name}', from) };
  return { error: x.errors.bad };
}

export async function declineHandoverAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), x = getDictionary(lang).money;
  const me = await requireMember(lang);
  const id = str(d, 'id'), from = str(d, 'from');
  if (!UUID.test(id)) return { error: x.errors.bad };
  const r = await declineHandover(db, me.flatId, me.memberId, id);
  refresh();
  if (r === 'ok' || r === 'declined') return { done: x.takeDeclined.replace('{name}', from) };
  if (r === 'accepted') return { done: x.takeDone };
  return { error: x.takeStale.replace('{name}', from) };
}
