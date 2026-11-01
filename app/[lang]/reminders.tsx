'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { logoutAction, removePushAction, savePushAction } from './actions';
import { apple, focus, link, secondary } from './ui';

type Copy = { on: string; turnOn: string; turnOff: string; hint: string; denied: string; unsupported: string; ios: string; failed: string };
type State = 'loading' | 'unsupported' | 'ios' | 'denied' | 'off' | 'on' | 'busy' | 'failed';

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const toKey = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')), c => c.charCodeAt(0));
const subscription = async () => (await navigator.serviceWorker.getRegistration('/sw.js'))?.pushManager.getSubscription();

/** What this browser can do right now. iPhone or iPad in Safari (not installed) gets the Home Screen hint. A subscription
 *  that already exists is saved again for whoever is signed in now: a shared phone follows the person, not the browser. */
async function detect(lang: string): Promise<State> {
  const ios = apple() && !matchMedia('(display-mode: standalone)').matches;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined' || !KEY) return ios ? 'ios' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await subscription();
  if (!sub) return 'off';
  await savePushAction(lang, sub.toJSON() as never);
  return 'on';
}

/** Reminders on this browser: one button, four states. `redraw`: once on, the page is drawn again (Home's ask card goes). */
export function Reminders({ lang, t, redraw }: { lang: string; t: Copy; redraw?: boolean }) {
  const [state, setState] = useState<State>('loading');
  const router = useRouter();
  useEffect(() => { detect(lang).then(setState, () => setState('unsupported')); }, [lang]);
  useEffect(() => { if (redraw && state === 'on') router.refresh(); }, [redraw, state, router]);
  const on = async () => {
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') return setState(answer === 'denied' ? 'denied' : 'off');   // dismissed the prompt: just not on
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(KEY) });
      await savePushAction(lang, sub.toJSON() as never);
      setState('on');
    } catch { setState('failed'); }   // the button stays, with words saying it didn't work
  };
  const off = async () => {
    setState('busy');
    try {
      const sub = await subscription();
      if (sub) { await removePushAction(lang, sub.endpoint); await sub.unsubscribe(); }
    } catch { /* the row may be gone already; either way this browser is off */ }
    setState('off');
  };
  if (state === 'loading') return null;
  if (state === 'unsupported' || state === 'ios' || state === 'denied') return <p className="text-[15px] text-muted">{t[state]}</p>;
  if (state === 'on') return <p className="text-[15px]">{t.on} · <button type="button" onClick={off} className={`min-h-11 text-[15px] ${link}`}>{t.turnOff}</button></p>;
  return (
    <>
      <button type="button" onClick={on} disabled={state === 'busy'} className={`${secondary} sm:w-auto`}>{t.turnOn}</button>
      <p role={state === 'failed' ? 'alert' : undefined} className={`mt-2 text-[15px] ${state === 'failed' ? 'font-semibold text-chili' : 'text-muted'}`}>{state === 'failed' ? t.failed : t.hint}</p>
    </>
  );
}

/** Sign out also stops this browser's reminders: on a shared phone the next person must not get mine. */
export function SignOut({ lang, label }: { lang: string; label: string }) {
  const out = async (d: FormData) => {
    try {
      const sub = await subscription();
      if (sub) { await removePushAction(lang, sub.endpoint); await sub.unsubscribe(); }
    } catch { /* no push here, or it is gone already: sign out anyway */ }
    await logoutAction(d);
  };
  return (
    <form action={out} className="mt-8">
      <input type="hidden" name="lang" value={lang} />
      <button className={`inline-flex min-h-11 items-center text-muted underline-offset-4 hover:underline ${focus}`}>{label}</button>
    </form>
  );
}
