import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSession, deleteSession, memberBySession, SESSION_DAYS } from './auth';
import { db } from './db';

const COOKIE = 'session';

export async function startSession(memberId: string) {
  await endSession();
  const token = await createSession(db, memberId);
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await deleteSession(db, token);
  jar.delete(COOKIE);
}

/** The logged-in member. flatId comes only from here, never from the URL or a form. */
export async function requireMember(lang: string) {
  const token = (await cookies()).get(COOKIE)?.value;
  const me = token ? await memberBySession(db, token) : null;
  if (!me) redirect(`/${lang}/join`);
  return me;
}

export async function requireManager(lang: string) {
  const me = await requireMember(lang);
  if (me.role !== 'manager') redirect(`/${lang}/home`);
  return me;
}
