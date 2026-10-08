'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { addMember, cleanName, createFlat, isPin, login, resetPin } from '@/lib/auth';
import { db } from '@/lib/db';
import { todayDhaka } from '@/lib/meals';
import { endSession, requireManager, startSession } from '@/lib/session';
import type { FormState } from './action-form';
import { getDictionary, hasLocale, type Locale } from './dictionaries';

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
