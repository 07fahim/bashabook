'use client';

import { useEffect, useState } from 'react';
import { removePushAction, savePushAction } from './actions';
import { link, secondary } from './ui';

type Copy = { on: string; turnOn: string; turnOff: string; hint: string; denied: string; unsupported: string; ios: string };
type State = 'loading' | 'unsupported' | 'ios' | 'denied' | 'off' | 'on' | 'busy';

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const toKey = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')), c => c.charCodeAt(0));
const subscription = async () => (await navigator.serviceWorker.getRegistration('/sw.js'))?.pushManager.getSubscription();

/** What this browser can do right now. iPhone or iPad in Safari (not installed) gets the Home Screen hint. A subscription
 *  that already exists is saved again for whoever is signed in now: a shared phone follows the person, not the browser. */
async function detect(lang: string): Promise<State> {
  const apple = /iPhone|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
  const ios = apple && !matchMedia('(display-mode: standalone)').matches;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined' || !KEY) return ios ? 'ios' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await subscription();
  if (!sub) return 'off';
  await savePushAction(lang, sub.toJSON() as never);
  return 'on';
}

/** Reminders on this browser: one button, four states. */
export function Reminders({ lang, t }: { lang: string; t: Copy }) {
  const [state, setState] = useState<State>('loading');
  useEffect(() => { detect(lang).then(setState, () => setState('unsupported')); }, [lang]);
  const on = async () => {
    setState('busy');
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const answer = await Notification.requestPermission();
      if (answer !== 'granted') return setState(answer === 'denied' ? 'denied' : 'off');   // dismissed the prompt: just not on
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(KEY) });
      await savePushAction(lang, sub.toJSON() as never);
      setState('on');
    } catch { setState('off'); }
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
      <p className="mt-2 text-[15px] text-muted">{t.hint}</p>
    </>
  );
}
