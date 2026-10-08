'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { addMember, cleanName, createFlat, isPin, login, resetPin } from '@/lib/auth';
import { db } from '@/lib/db';
import { addDays, editFrom, isDate, isLocked, isMeal, isPresent, mealDecision, MEALS, nowDhaka, todayDhaka } from '@/lib/meals';
import { changeMeal, decideRequest, loadMeals, mealRules, noCooking, saveMeal, setInMeals, setAway, setCookLink, setDefaults, updateSettings } from '@/lib/meals-db';
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
  const name = cleanName(d.get('name'));
  if (!name) return { error: a.errors.name };
  if (!(await addMember(db, me.flatId, name, todayDhaka()))) return { error: a.errors.nameTaken };
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
  const date = str(d, 'date'), meal = str(d, 'meal'), count = plates(str(d, 'count'));
  if (inRange(date) && isMeal(meal) && count !== null) {
    await changeMeal(db, me.flatId, { memberId: me.memberId, date, meal, count }, nowDhaka(), me.role === 'manager');
  }
  refresh();   // also redraws a page left open past midnight
}

export async function guestAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
  const date = str(d, 'date'), meal = str(d, 'meal'), count = plates(str(d, 'plates'));
  if (!inRange(date) || !isMeal(meal) || count === null) return { error: m.errors.bad };
  const r = await changeMeal(db, me.flatId, { memberId: me.memberId, date, meal, count }, nowDhaka(), me.role === 'manager');
  if (r === 'closed') return { error: m.errors.closed };
  refresh();
  return { done: r === 'request' ? m.sentForApproval : m.saved };
}

export async function awayAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
  const from = str(d, 'from'), to = str(d, 'to');
  if (!inRange(from) || !isDate(to) || to < from) return { error: m.errors.bad };
  if (to > addDays(from, 59)) return { error: m.errors.range };
  const now = nowDhaka(), r = await mealRules(db, me.flatId);
  let first = now.slice(0, 10);
  while (mealDecision(first, now, r.cutoff, r.strictness) !== 'open') first = addDays(first, 1);
  if (from < first) return { error: m.errors.awayFrom.replace('{d}', fmtDay(first, lang)) };
  await setAway(db, me.flatId, me.memberId, from, to);
  refresh();
  return { done: m.saved };
}

export async function usualAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireMember(lang);
  await setDefaults(db, me.flatId, me.memberId, { b: d.has('b'), l: d.has('l'), d: d.has('d') }, await lastLocked(me.flatId));
  refresh();
  return { done: m.saved };
}

export async function decideAction(d: FormData) {
  const me = await requireManager(langOf(d));
  await decideRequest(db, me.flatId, me.memberId, str(d, 'id'), str(d, 'approve') === '1', todayDhaka());
  refresh();
}

export async function settingsAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireManager(lang);
  const cutoff = str(d, 'cutoff').slice(0, 5), strictness = str(d, 'strictness');
  const [b, l, dd] = MEALS.map(x => (/^\d{1,2}(\.\d{1,2})?$/.test(str(d, `w_${x}`)) ? Math.round(Number(str(d, `w_${x}`)) * 100) : -1));
  const weightsOk = [b, l, dd].every(w => w >= 0 && w <= 1000);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff) || (strictness !== 'relaxed' && strictness !== 'strict') || !weightsOk) return { error: m.errors.bad };
  await updateSettings(db, me.flatId, { cutoff, strictness, weights: { b, l, d: dd } });
  refresh();
  return { done: m.saved };
}

export async function cookLinkAction(d: FormData) {
  const me = await requireManager(langOf(d));
  await setCookLink(db, me.flatId, str(d, 'on') === '1');
  refresh();
}

const editable = (date: string) => isDate(date) && date >= editFrom(todayDhaka()) && date <= addDays(todayDhaka(), 60);

/** The starter changes anyone's meal, today and past days included. Saved as late once the day is locked. */
export async function adminMealAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireManager(lang);
  const memberId = str(d, 'memberId'), date = str(d, 'date'), meal = str(d, 'meal'), count = plates(str(d, 'plates'));
  const { members } = await loadMeals(db, me.flatId, date, date);
  const member = members.find(x => x.id === memberId);
  if (!member || !editable(date) || !isPresent(member, date) || !isMeal(meal) || count === null) return { error: m.errors.bad };
  const r = await mealRules(db, me.flatId);
  await saveMeal(db, me.flatId, me.memberId, { memberId, date, meal, count }, isLocked(date, nowDhaka(), r.cutoff));
  refresh();
  return { done: m.saved };
}

export async function noCookAction(_: FormState, d: FormData): Promise<FormState> {
  const lang = langOf(d), m = getDictionary(lang).meals;
  const me = await requireManager(lang);
  const from = str(d, 'from'), to = str(d, 'to'), meals = MEALS.filter(x => d.has(x));
  if (!editable(from) || !editable(to) || to < from) return { error: m.errors.bad };
  if (to > addDays(from, 59)) return { error: m.errors.range };
  if (!meals.length) return { error: m.errors.pickMeal };
  await noCooking(db, me.flatId, me.memberId, from, to, meals, todayDhaka());
  refresh();
  return { done: m.saved };
}

/** The last day members can no longer change: tomorrow once it's past the cutoff, else today. */
async function lastLocked(flatId: string) {
  const now = nowDhaka(), today = now.slice(0, 10), r = await mealRules(db, flatId);
  return isLocked(addDays(today, 1), now, r.cutoff) ? addDays(today, 1) : today;
}

export async function inMealsAction(d: FormData) {
  const me = await requireMember(langOf(d));
  await setInMeals(db, me.flatId, me.memberId, str(d, 'on') === '1', await lastLocked(me.flatId));
  refresh();
}
