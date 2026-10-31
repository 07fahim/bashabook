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

/** This phone's session token (for keeping it signed in when my PIN changes). */
export const currentToken = async () => (await cookies()).get(COOKIE)?.value ?? '';

/** The signed-in member, or null (for routes that answer 404 instead of redirecting). */
export async function currentMember() {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? memberBySession(db, token) : null;
}

/** The logged-in member. flatId comes only from here, never from the URL or a form. */
/** `why`: from a Server Action, so the sign-in page it lands on can say the typed data wasn't saved (a page load goes to the landing page). */
export async function requireMember(lang: string, why = false) {
  const token = (await cookies()).get(COOKIE)?.value;
  const me = token ? await memberBySession(db, token) : null;
  // a page opened signed out (the app icon, a bookmark) goes to the landing page: its first screen has Create a flat, Sign
  // in and Back to the flat; a save that found the session gone goes to sign-in with the note that nothing was saved
  if (!me) redirect(why ? `/${lang}/join?why=out` : `/${lang}`);
  return me;
}

export async function requireManager(lang: string, why = false) {
  const me = await requireMember(lang, why);
  if (me.role !== 'manager') redirect(`/${lang}/home${why ? '?why=role' : ''}`);
  return me;
}
