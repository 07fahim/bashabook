'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { addMember, cleanName, createFlat, isPin, login, resetPin } from '@/lib/auth';
import { db } from '@/lib/db';
import { addDays, editFrom, isDate, isLocked, isMeal, isPresent, MEALS, nowDhaka, todayDhaka } from '@/lib/meals';
import {
  addGuests, cancelAway, cookAgain, isInMeals, loadMeals, mealRules, noCooking, removeGuests, saveMeal, setAway, setCookLink, setDefaults, setOwn, updateSettings,
} from '@/lib/meals-db';
import { endSession, requireManager, requireMember, startSession } from '@/lib/session';
import type { FormState } from './action-form';
import { getDictionary, hasLocale, type Locale } from './dictionaries';
import { fmtDay } from './format';

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
  const name = cleanName(d.get('name')), joinedOn = str(d, 'joinedOn');
  if (!name) return { error: a.errors.name };
  if (!isDate(joinedOn) || joinedOn < todayDhaka() || !editable(joinedOn)) return { error: getDictionary(lang).meals.errors.bad };
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
  const date = str(d, 'date'), meal = str(d, 'meal');
  if (inRange(date) && isMeal(meal)) await removeGuests(db, me.flatId, me.memberId, date, meal, nowDhaka());
  refresh();
}

export async function guestAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
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
  // all three off = cooking for yourself; any on = back in shared meals
  const usual = { b: d.has('b'), l: d.has('l'), d: d.has('d') };
  const inMeals = usual.b || usual.l || usual.d, was = await isInMeals(db, me.flatId, me.memberId);
  await setDefaults(db, me.flatId, me.memberId, usual, editFrom(todayDhaka()), await lastLocked(me.flatId), inMeals === was ? null : inMeals);
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
  await updateSettings(db, me.flatId, me.memberId, { cutoff, weights: { b, l, d: dd } });
  refresh();
  return { done: m.saved };
}

export async function cookLinkAction(d: FormData) {
  const me = await requireManager(langOf(d));
  await setCookLink(db, me.flatId, str(d, 'on') === '1');
  refresh();
}

const editable = (date: string) => isDate(date) && date >= editFrom(todayDhaka()) && date <= addDays(todayDhaka(), 60);

export async function noCookAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireManager(lang);
  const from = str(d, 'from'), to = str(d, 'to'), meals = MEALS.filter(x => d.has(x));
  if (!editable(from) || !editable(to) || to < from) return { error: m.errors.bad };
  if (to > addDays(from, 59)) return { error: m.errors.range };
  if (!meals.length) return { error: m.errors.pickMeal };
  await noCooking(db, me.flatId, me.memberId, from, to, meals, await lastLocked(me.flatId));
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
  const from = str(d, 'from'), to = str(d, 'to'), first = addDays(await lastLocked(me.flatId), 1);
  if (!isDate(from) || !isDate(to) || to < first) return { error: m.errors.bad };
  await cancelAway(db, me.flatId, me.memberId, from < first ? first : from, to);
  refresh();
  return { done: m.saved };
}

/** The flat's starter sets anyone's plates for a meal (− / +), today and past days included. Late once the day is locked. */
export async function adminSetAction(d: FormData) {
  const me = await requireManager(langOf(d));
  // own plate and guests are set separately, so a guest change never touches someone's own meal and back
  const memberId = str(d, 'memberId'), date = str(d, 'date'), meal = str(d, 'meal'), own = str(d, 'own'), guests = plates(str(d, 'guests'));
  const member = (await loadMeals(db, me.flatId, date, date)).members.find(x => x.id === memberId);
  if (member && editable(date) && isPresent(member, date) && isMeal(meal) && (own === '0' || own === '1') && guests !== null && guests <= 9) {
    const r = await mealRules(db, me.flatId);
    await saveMeal(db, me.flatId, me.memberId, { memberId, date, meal, count: Number(own) + guests, guests }, isLocked(date, nowDhaka(), r.cutoff));
  }
  refresh();
}

/** The cook is back for one listed no-cooking day. */
export async function noCookCancelAction(d: FormData) {
  const me = await requireManager(langOf(d));
  const date = str(d, 'date'), meals = str(d, 'meals').split(',').filter(isMeal);
  if (editable(date) && meals.length) await cookAgain(db, me.flatId, me.memberId, date, date, meals, date);
  refresh();
}
